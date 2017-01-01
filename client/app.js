'use strict';
const Promise = require('bluebird');
const electron = require('electron');
const path = require('path');
const fs = require('fs-extra');
const cvs = require('../cvs.js');
const mime = require('mime');
const coroutine = Promise.coroutine;
const assign = Object.assign;
const readFile = Promise.promisify(fs.readFile);
const cmsettings = {indentUnit: 4, lineNumbers: true};

let zon;

const refresh = coroutine(function*(opt){
    opt = opt||{};
    let toolbar = w2ui.layout.get('left').toolbar;
    let home = process.env.HOME;
    let collator = new Intl.Collator(undefined,
        {numeric: true, sensitivity: 'base'});
    let zons = (yield Promise.promisify(fs.readdir)(home))
        .filter(name=>/^zon\d*$|home_zon/.test(name))
        .sort(collator.compare)
        .map(z=>path.join(home, z));
    if (!zons.length)
        return;
    zon = opt.zon||zon;
    if (zon && zons.indexOf(zon)<0)
    {
        zon = null;
        w2ui.layout.content('main', '');
        w2ui.cvs.clear();
    }
    let combo = toolbar.get('zon');
    if (zons.length!=combo.items.length ||
        !zons.every((v, i)=>v==combo.items[i].id))
    {
        combo.items = zons.map(zon=>assign({id: zon,
            text: path.basename(zon)}));
    }
    if (!zon || opt.zon)
    {
        zon = opt.zon||zons[0];
        toolbar.set('zon', {text: path.basename(zon)});
        toolbar.refresh();
        w2ui.cvs.clear();
    }
    try {
        const mode = '?ACM';
        w2ui.cvs.lock('', true);
        let res = (yield cvs.modified(zon)).sort((rec1, rec2)=>{
            return (rec2.directory&&1||0)-(rec1.directory&&1||0) ||
                mode.indexOf(rec1.mode)-mode.indexOf(rec2.mode) ||
                collator.compare(rec1.filename, rec2.filename);
        });
        if (res.length==w2ui.cvs.records.length &&
            w2ui.cvs.records.every((rec, i)=>rec.filename==res[i].filename &&
            rec.mode==res[i].mode))
        {
            return;
        }
        w2ui.cvs.clear(false);
        w2ui.cvs.add(res.map(item=>assign(item, {recid: path.join(zon, item.filename)})));
        update_toolbar();
    } finally {
        w2ui.cvs.unlock();
    }
});

const update_toolbar = ()=>{
    let toolbar = w2ui.layout.get('left').toolbar;
    let files = w2ui.cvs.getSelection().map(filename=>w2ui.cvs.get(filename));
    w2ui.layout.content('main', '');
    const is_mode = mode=>files.length &&
        files.filter(rec=>mode.indexOf(rec.mode)>=0).length==files.length;
    toolbar[is_mode('?AM') ? 'enable' : 'disable']('commit');
    toolbar[files.length ? 'enable' : 'disable']('discard');
};

$('#layout').w2layout({
    name: 'layout',
    panels: [
        {type: 'left', size: '30%', resizable: true, style: 'background-color: #F5F6F7;',
            toolbar: {
                items: [
                    {type: 'menu', id: 'zon', img: 'icon-folder', items: []},
                    {type: 'spacer'},
                    {type: 'break'},
                    {type: 'button',  id: 'commit', tooltip: 'Commit', icon: 'fa fa-cloud-upload', disabled: true},
                    {type: 'button',  id: 'discard', tooltip: 'Discard', icon: 'fa fa-trash', disabled: true},
                ],
                onClick: evt=>{
                    let files = w2ui.cvs.getSelection();
                    switch(evt.target.split(':')[0])
                    {
                    case 'commit':
                        evt.done(()=>w2prompt('Commit Message', 'Commit Changes?').ok(coroutine(function*(){
                            return console.log(this);
                            for (let filename of files)
                            {
                                let node = w2ui.cvs.get(filename);
                                if (!node)
                                    return;
                                switch(node.mode)
                                {
                                case '?':
                                    //yield cvs.add(filename);
                                    break;
                                }
                            }
                        })));
                        break;
                    case 'discard':
                        evt.done(()=>w2confirm(files.join('<br>'), 'Discard Changes?').yes(coroutine(function*(){
                            yield Promise.all(files.map(coroutine(function*(filename){
                                let node = w2ui.cvs.get(filename);
                                if (!node)
                                    return;
                                switch(node.mode)
                                {
                                case '?':
                                    return yield Promise.promisify(fs.remove)(filename);
                                case 'A':
                                    return yield cvs.remove(filename);
                                case 'C':
                                case 'M':
                                    return yield cvs.discard(filename);
                                }
                            })));
                            yield refresh();
                        })));
                        break;
                    case 'zon':
                        if (!evt.subItem)
                            return;
                        refresh({zon: evt.subItem.id});
                        break;
                    }
                },
            }},
        {type: 'main', style: 'background-color: #F5F6F7; padding: 5px;'},
    ],
});

w2ui.layout.content('left', $().w2grid({
    name: 'cvs',
    show: {selectColumn: true},
    columns: [
        {field: 'filename', caption: 'Filename', size: '100%', sortable: false, render: (rec, i)=>
            $('<div>').append($('<div>').text(' '+rec.filename).prepend($('<span>',
                {class: `fa fa-${rec.directory ? 'folder' : 'file'}-o`}))).html()},
        {field: 'mode', caption: '', size: '25px', attr: 'align=center', sortable: false},
    ],
    onSelect: function(evt){
        evt.done(coroutine(function*(){
            update_toolbar();
            if (evt.column===null)
                return;
            let node = this.get(evt.recid);
            if (node.directory)
                return;
            let filename = path.join(zon, node.filename);
            if (filename.indexOf('.')>=0 &&
                !/\.(js|html|css|txt|log|json|sh|pl|h|c|csv|patch|pem)$/i.test(filename))
            {
                return;
            }
            switch (node.mode)
            {
            case '?':
            case 'A':
                try {
                    w2ui.layout.lock('main', '', true);
                    CodeMirror(w2ui.layout.el('main'),
                        assign({value: yield readFile(filename, 'utf8'),
                            readOnly: true, mode: mime.lookup(filename)}, cmsettings));
                } finally { w2ui.layout.unlock('main'); }
                break;
            case 'C':
            case 'M':
                try {
                    w2ui.layout.lock('main', '', true);
                    CodeMirror.MergeView(w2ui.layout.el('main'),
                        assign(yield cvs.diff(filename), cmsettings));
                } finally { w2ui.layout.unlock('main'); }
                break;
            }
        }));
    },
    onUnselect: evt=>evt.done(update_toolbar),
}));


electron.ipcRenderer.on('window', (evt, msg)=>{
    if (msg=='focus')
        return refresh();
});

refresh();

