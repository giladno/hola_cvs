'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const electron = require('electron');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config.js');
const cvs = require('../cvs.js');
const mime = require('mime-types');
const coroutine = Promise.coroutine;
const assign = Object.assign;
const readFile = Promise.promisify(fs.readFile)
const writeFile = Promise.promisify(fs.writeFile);

let zon = localStorage.zon;

let tabs = {console: $('<pre>').css({
    margin: 0,
    padding: '0.5em',
    overflow: 'auto',
    width: '100%',
    height: '100%',
    'background-color': 'white',
})};

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
        w2ui.cvs.clear();
    }
    toolbar.set('zon', {text: path.basename(zon)});
    localStorage.zon = zon;
    try {
        const mode = '?ACM';
        w2ui.cvs.lock('', true);
        let res = yield cvs.modified(zon);
        res = res.filter(rec=>rec.filename!='.stash');
        res = res.sort((rec1, rec2)=>{
            return (rec2.directory&&1||0)-(rec1.directory&&1||0) ||
                mode.indexOf(rec1.mode)-mode.indexOf(rec2.mode) ||
                collator.compare(rec1.filename, rec2.filename);
        });
        if (res.length!=w2ui.cvs.records.length ||
            !w2ui.cvs.records.every((rec, i)=>rec.filename==res[i].filename &&
            rec.mode==res[i].mode))
        {
            w2ui.cvs.clear(false);
            w2ui.cvs.add(res.map(item=>assign(item,
                {recid: path.join(zon, item.filename)})));
            update_toolbar();
        }
    } finally {
        w2ui.cvs.unlock();
    }
    let stash = path.join(zon, '.stash');
    yield Promise.promisify(fs.ensureDir)(stash);
    let files = yield Promise.promisify(fs.readdir)(stash);
    let menu = toolbar.get('stash');
    menu.items = menu.items.slice(0, 2).concat(files.map(filename=>assign({
        text: path.basename(filename, '.patch'),
        id: path.join(stash, filename),
    })));
    toolbar.refresh();
});

const update_toolbar = ()=>{
    let files = w2ui.cvs.getSelection().map(filename=>w2ui.cvs.get(filename));
    let toolbar = w2ui.layout.get('main').toolbar;
    w2ui.layout.content('main', '');
    toolbar.off('click');
    toolbar.disable.apply(toolbar, toolbar.items.map(item=>item.id)
        .filter(id=>id!='settings'));
    const is_mode = mode=>files.length &&
        files.filter(rec=>mode.indexOf(rec.mode)>=0).length==files.length;
    w2ui.layout.get('left').toolbar[is_mode('?AMUR') ? 'enable' :
        'disable']('commit');
    w2ui.layout.get('left').toolbar[is_mode('M') ? 'enable' :
        'disable']('stash:');
    w2ui.layout.get('left').toolbar[files.length ? 'enable' :
        'disable']('discard');
};

$('#layout').w2layout({
    name: 'layout',
    panels: [
        {type: 'left', size: '30%', resizable: true, style: 'background-color: #F5F6F7;',
            toolbar: {
                items: [
                    {type: 'menu', id: 'stash', icon: 'fa fa-suitcase', items: [
                        {text: 'Stash...', id: ''},
                        {text: '--'},
                    ]},
                    {type: 'break'},
                    {type: 'menu', id: 'zon', img: 'icon-folder', items: []},
                    {type: 'spacer'},
                    {type: 'button', id: 'commit', tooltip: 'Commit',
                        icon: 'fa fa-cloud-upload', disabled: true},
                    {type: 'break'},
                    {type: 'button', id: 'discard', tooltip: 'Discard',
                        icon: 'fa fa-trash', disabled: true},
                ],
                onClick: coroutine(function*(evt){
                    let files = w2ui.cvs.getSelection();
                    switch(evt.target.split(':')[0])
                    {
                    case 'commit':
                        try {
                            yield cvs.lint(zon, files.map(filename=>{
                                let node = w2ui.cvs.get(filename);
                                switch (node.mode)
                                {
                                case 'R':
                                case 'U':
                                    return '';
                                }
                                return node.filename;
                            }));
                        }
                        catch(err) {
                            if (err.stdout)
                            {
                                w2popup.open({
                                    title: 'Lint',
                                    body: $('<pre style="white-space: pre-wrap;">').text(err.stdout)[0].outerHTML,
                                });
                            }
                            return;
                        }
                        w2ui.commit.off('action');
                        w2ui.commit.on('action', coroutine(function*(){
                            let record = w2ui.commit.record;
                            if (!(record.message = record.message.trim()) && !record.dry_run)
                                return $('#w2ui-popup textarea').focus();
                            w2popup.close();
                            let message = record.message;
                            if (record.notify.length)
                            {
                                message += '\nNOTIFY: '+
                                    record.notify.map(user=>user.id).join(' ');
                            }
                            files = yield Promise.all(files.map(coroutine(function*(filename){
                                let node = w2ui.cvs.get(filename);
                                if (record.dry_run)
                                    return node.filename;
                                switch(node.mode)
                                {
                                case '?':
                                    yield cvs.add(filename);
                                    break;
                                case 'U':
                                    yield cvs.remove(filename);
                                    break;
                                }
                                return node.filename;
                            })));
                            try {
                                let res = yield cvs.commit({
                                    zon: zon,
                                    files: files,
                                    message: message,
                                    dry_run: record.dry_run,
                                });
                                tabs.console.append(res.stdout.trim()+'\n');
                                assign(record, {
                                    message: '',
                                    dry_run: false,
                                    notify: [],
                                });
                            }
                            catch(err) {
                                if (err.code)
                                {
                                    w2popup.open({
                                        title: 'CVS Output',
                                        body: $('<pre style="white-space: pre-wrap;">')
                                            .text(err.stderr||'')[0].outerHTML,
                                    });
                                }
                            }
                            refresh();
                        }));
                        try {
                            let filename = path.join(process.env.PROJECT_PATH||zon,
                                'pkg/system/db/users.js');
                            delete require.cache[filename];
                            w2ui.commit.fields[1].options.items = require(filename).data
                                .filter(user=>user.active && !user.user_type)
                                .map(user=>assign({id: user.login,
                                    text: user.first_name+' '+user.last_name}))
                                .sort((u1, u2)=>u1.text.toLowerCase()
                                    .localeCompare(u2.text.toLowerCase()));
                        } catch(err) {}
                        $().w2popup('open', {
                            title: 'Commit',
                            body: '<div id=commit style="width: 100%; height: 100%;"></div>',
                            style: 'padding: 15px 0px 0px 0px',
                            width: 500,
                            height: 300,
                            showMax: true,
                            onToggle: evt=>{
                                $(w2ui.commit.box).hide();
                                evt.done(()=>{
                                    $(w2ui.commit.box).show();
                                    w2ui.commit.resize();
                                });
                            },
                            onOpen: evt=>evt.done(()=>{
                                $('#w2ui-popup #commit').w2render('commit');
                                $('#commit [name=files]').text(files.join('\n'));
                            }),
                        });
                        break;
                    case 'discard':
                        w2popup.open({
                            title: 'Discard',
                            body: $('<div class=w2ui-left>').css({padding: '1em 0.5em'}).append([
                                $('<span>').text('Discard '+files.length+' file(s)?'),
                                $('<pre>').text(files.join('\n')),
                            ])[0].outerHTML,
                            buttons: '<input type=button class=btn value=Discard>',
                            modal: true,
                            onOpen: evt=>{
                                evt.done(()=>{
                                    $('#w2ui-popup .btn').on('click', coroutine(function*(evt){
                                        w2popup.close();
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
                                            case 'U':
                                                return yield cvs.discard(filename);
                                            }
                                        })));
                                        yield refresh();
                                    }));
                                });
                            },
                        });
                        break;
                    case 'stash':
                        if (!evt.subItem)
                            return;
                        if (!evt.subItem.id)
                        {
                            return w2prompt('Name', 'Stash').ok(coroutine(function*(name){
                                yield cvs.stash(zon,
                                    files.map(filename=>w2ui.cvs.get(filename).filename), name);
                                yield refresh();
                            }));
                        }
                        try {
                            let res = yield cvs.patch(zon, evt.subItem.id);
                            tabs.console.append(res.stdout.trim()+'\n');
                            yield refresh();
                        }
                        catch(err) {
                            if (err.code)
                            {
                                w2popup.open({
                                    title: 'Patch Output',
                                    body: $('<pre style="white-space: pre-wrap;">')
                                        .text(err.stdout||'')[0].outerHTML,
                                });
                            }
                        }
                        break;
                    case 'zon':
                        if (!evt.subItem)
                            return;
                        refresh({zon: evt.subItem.id});
                        break;
                    }
                }),
            }},
        {type: 'main', style: 'background-color: #F5F6F7; padding: 5px;', toolbar: {
            items: [
                {type: 'button', id: 'save', tooltip: 'Save',
                    icon: 'fa fa-save', disabled: true},
                {type: 'break'},
                {type: 'button', id: 'next_diff', tooltip: 'Next Diff',
                    icon: 'fa-angle-double-down fa', disabled: true},
                {type: 'button', id: 'prev_diff', tooltip: 'Previous Diff',
                    icon: 'fa-angle-double-up fa', disabled: true},
                {type: 'spacer'},
                {type: 'button', id: 'settings', tooltip: 'Settings',
                    icon: 'fa fa-gear', onClick: evt=>evt.done(()=>$().w2popup('open', {
                        title: 'Settings',
                        body: '<div id=settings style="width: 100%; height: 100%;"></div>',
                        style: 'padding: 15px 0px 0px 0px',
                        width: 500,
                        height: 300,
                        showMax: true,
                        onToggle: evt=>{
                            $(w2ui.settings.box).hide();
                            evt.done(()=>{
                                $(w2ui.settings.box).show();
                                w2ui.settings.resize();
                            });
                        },
                        onOpen: evt=>evt.done(()=>{
                            $('#w2ui-popup #settings').w2render('settings');
                        }),
                        onClose: evt=>evt.done(()=>{
                            _.forEach(w2ui.settings.record,
                                (val, path)=>_.set(config, path, val));
                            localStorage.config = JSON.stringify(config);
                        }),
                    }))},
            ],
        }},
        {type: 'bottom', size: '20%', resizable: true, tabs: {
            tabs: [{id: 'console', caption: 'Console'}],
            onClick: evt=>$(w2ui.layout.el('bottom')).empty().append(tabs[evt.target]),
        }},
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
            let type = mime.lookup(filename)||'application/octet-stream';
            console.log(type);
            if (!/^(text)\/|(xml|x-sh|ca-cert|perl|javascript)$/.test(type))
            {
                return console.log('binary file:', filename, type);
            }
            switch (node.mode)
            {
            case '?':
            case 'A':
                try {
                    w2ui.layout.lock('main', '', true);
                    CodeMirror(w2ui.layout.el('main'),
                        assign({value: yield readFile(filename, 'utf8'),
                            readOnly: true, mode: type}, config.cm));
                } finally { w2ui.layout.unlock('main'); }
                break;
            case 'C':
            case 'M':
                try {
                    w2ui.layout.lock('main', '', true);
                    let cm = CodeMirror.MergeView(w2ui.layout.el('main'),
                        assign(yield cvs.diff(filename), config.cm));
                    let editor = cm.editor();
                    let toolbar = w2ui.layout.get('main').toolbar;
                    toolbar.enable('next_diff', 'prev_diff');
                    editor.on('change', ()=>toolbar[editor.isClean() ?
                        'disable' : 'enable']('save'));
                    toolbar.on('click', coroutine(function*(evt){
                        switch(evt.target)
                        {
                        case 'save':
                            yield writeFile(filename, editor.getValue());
                            editor.markClean();
                            w2ui.layout.get('main').toolbar.disable('save');
                            return;
                        case 'next_diff':
                            return editor.execCommand('goNextDiff');
                        case 'prev_diff':
                            return editor.execCommand('goPrevDiff');
                        }
                    }));
                    editor.execCommand('goNextDiff');
                } finally { w2ui.layout.unlock('main'); }
                break;
            }
        }));
    },
    onUnselect: evt=>evt.done(update_toolbar),
}));

w2ui.layout.get('bottom').tabs.click('console');

$().w2form({
    name: 'commit',
    style: 'border: 0px; background-color: transparent;',
    formHTML:
        `<div class="w2ui-page page-0">
            <div class=w2ui-field>
                <label>Message:</label>
                <div>
                   <textarea name=message style="width: 100%"></textarea>
                </div>
            </div>
            <div class=w2ui-field>
                <label>Notify:</label>
                <div>
                    <input name=notify>
                </div>
            </div>
            <div class=w2ui-field>
                <label>Files:</label>
                <div>
                    <pre name=files style="padding: 0.4em; width: 100%;
                      background-color: white; border: 1px solid #bbb;"></pre>
                </div>
            </div>
            <div class=w2ui-field>
                <label>Dry Run:</label>
                <div>
                    <input name=dry_run type=checkbox>
                </div>
            </div>
        </div>
        <div class=w2ui-buttons>
            <input type=button class=btn name=save value=Commit>
        </div>`,
    record: {message: '', notify: [], dry_run: false},
    fields: [
        {field: 'message', type: 'textarea', required: true},
        {field: 'notify', type: 'enum', options: {openOnFocus: true, items: []}},
        {field: 'dry_run', type: 'checkbox'},
    ],
    actions: {save: ()=>{}},
});

const fields = [
    {field: 'cm.indentUnit', type: 'int', html: {caption: 'Indent Unit'}},
    {field: 'cm.lineNumbers', type: 'checkbox', html: {caption: 'Show Line Numbers'}},
    {field: 'cm.collapseIdentical', type: 'checkbox', html: {caption: 'Collapse Identical'}},
    {field: 'lint.code', type: 'checkbox', html: {caption: 'Lint Code'}},
];

$().w2form({
    name: 'settings',
    style: 'border: 0px; background-color: transparent;',
    record: fields.reduce((o, field)=>assign(o,
        {[field.field]: _.get(config, field.field)}), {}),
    fields: fields,
});

electron.ipcRenderer.on('window', (evt, msg)=>{
    if (msg=='focus')
        return refresh();
});

refresh();

