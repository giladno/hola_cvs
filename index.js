'use strict';
const url = require('url');
const path = require('path');
const electron = require('electron');
const app = electron.app;
const argv = require('minimist')(process.argv.slice(2));

let win;

const create_window = ()=>{
    win = new electron.BrowserWindow({width: 1024, height: 768});
    win.loadURL(url.format({
        pathname: path.join(__dirname, 'client', 'index.html'),
        protocol: 'file:',
        slashes: true,
    }));
    win.on('closed', ()=>win = null);
    win.on('focus', ()=>win.webContents.send('window', 'focus'));
    if (argv.debug)
        win.webContents.openDevTools();
};

app.on('ready', create_window);
app.on('window-all-closed', ()=>app.quit());
