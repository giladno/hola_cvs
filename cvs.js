'use strict';
const Promise = require('bluebird');
const path = require('path');
const fs = require('fs-extra');
const child_process = require('child_process');
const mime = require('mime');
const coroutine = Promise.coroutine;
const assign = Object.assign;
const stat = Promise.promisify(fs.stat);
const readFile = Promise.promisify(fs.readFile);

const execute = (dir, cmd, args)=>new Promise((resolve, reject)=>{
    let opt = dir;
    if (typeof dir!='object')
        opt = {dir: dir, cmd: cmd, args: args};
    opt.timeout = opt.timeout||30000;
    let child = child_process.spawn(opt.cmd, opt.args, {cwd: opt.dir});
    if (opt.stdin)
    {
        child.stdin.setEncoding('utf-8');
        child.stdin.end(opt.stdin);
    }
    if (opt.no_wait)
        return resolve(child);
    let timer = opt.timeout>0 && setTimeout(()=>child.kill(), opt.timeout);
    let res = {stdout: '', stderr: ''};
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data=>res.stdout += data);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data=>res.stderr += data);
    child.on('close', (code, signal)=>{
        if (timer)
            clearTimeout(timer);
        if (signal)
        {
            let err = new Error('spawn signal error');
            err.code = code;
            err.signal = signal;
            return reject(err);
        }
        if (res.code = code)
        {
            let err = new Error('spawn result error');
            err.code = code;
            return reject(err);
        }
        resolve(res);
    }).on('error', err=>{
        if (timer)
            clearTimeout(timer);
        reject(err);
    });
});

module.exports.modified = coroutine(function*(dir){
    let res = yield execute(dir, 'jcvs', ['up', '-o']);
    let files = res.stdout.trim().split('\n').map(line=>assign({
        filename: line.substr(2),
        mode: line.substr(0, 1),
    }));
    return yield Promise.all(files.map(entry=>coroutine(function*(){
        if (entry.mode=='U')
            return entry;
        let s = yield stat(path.join(dir, entry.filename));
        if (s.isDirectory())
            entry.directory = true;
        return entry;
    })()));
});

module.exports.revision = coroutine(function*(filename, rev){
    if (!rev)
    {
        let res = yield execute(path.dirname(filename), 'jcvs', ['revision',
            path.basename(filename)]);
        rev = res.stdout.trim();
    }
    let res = yield execute(path.dirname(filename), 'cvs', ['update', '-r',
        rev, '-p', path.basename(filename)]);
    return res.stdout;
});

module.exports.diff = coroutine(function*(filename){
    let res = yield Promise.all([
        module.exports.revision(filename),
        readFile(filename, 'utf8'),
    ]);
    return {orig: res[0], value: res[1], mime: mime.lookup(filename)};
});

module.exports.add = coroutine(function*(filename){
    yield execute(path.dirname(filename), 'cvs', ['add',
        path.basename(filename)]);
});

module.exports.remove = coroutine(function*(filename){
    yield execute(path.dirname(filename), 'cvs', ['remove', '-Rf',
        path.basename(filename)]);
});

module.exports.discard = coroutine(function*(filename, rev){
    if (!rev)
    {
        let res = yield execute(path.dirname(filename), 'jcvs', ['revision',
            path.basename(filename)]);
        rev = res.stdout.trim();
    }
    yield execute(path.dirname(filename), 'cvs', ['update', '-C',
        '-r', rev, path.basename(filename)]);
});
