'use strict';
// Run with Electron, with an isolated disposable profile and synthetic microphone.
const electron = require('electron'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict'), Module = require('node:module');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'audit-evidence');
const profile = fs.mkdtempSync(path.join(evidence, 'smoke-profile-'));
electron.app.setPath('userData', profile);
electron.app.commandLine.appendSwitch('use-fake-device-for-media-stream');
electron.app.disableHardwareAcceleration();
const originalLoad = Module._load;
class HiddenWindow extends electron.BrowserWindow { constructor(options) { super({ ...options, show: false }); } }
Module._load = function(name, ...args) { return name === 'electron' ? { ...electron, BrowserWindow: HiddenWindow } : originalLoad.call(this, name, ...args); };
let mainWindow;
const ready = new Promise(resolve => electron.app.once('browser-window-created', (event, win) => { mainWindow = win; win.webContents.once('did-finish-load', resolve); }));
require(path.join(root, 'main.js'));
Module._load = originalLoad;
const timeout = setTimeout(() => { console.error('Smoke test timeout'); electron.app.exit(1); }, 60000);
(async () => {
  await ready;
  const run = code => mainWindow.webContents.executeJavaScript(code);
  const initial = await run(`({bridge: !!window.audioFolderAPI && !!window.recordingAPI, node: typeof require, errors: document.getElementById('runtimeErrBar')?.textContent || ''})`);
  assert.equal(initial.bridge, true); assert.equal(initial.node, 'undefined'); assert.equal(initial.errors, '');
  await run(`(() => { const file = new File([JSON.stringify({songs:[{id:'smoke',title:'安全测试 <img src=x>',rawLyrics:'第一行歌词\\n第二行歌词'}]})], 'test.json', {type:'application/json'}); const dt = new DataTransfer(); dt.items.add(file); const input = document.getElementById('importFile'); input.files = dt.files; input.dispatchEvent(new Event('change')); })()`);
  await run(`new Promise((resolve,reject) => { const start=Date.now(); const timer=setInterval(() => { if (window.__annotator.listSongs().some(s=>s.id==='smoke')) {clearInterval(timer);resolve(true);} else if(Date.now()-start>5000){clearInterval(timer);reject(Error('Import did not complete'));} },25); })`);
  const exports = await run(`(async () => { document.getElementById('previewExportBtn').click(); const target=document.getElementById('exportCapture'); if(target.querySelector('img')) throw Error('HTML injection'); const canvas=await html2canvas(target,{scale:1,backgroundColor:null,width:target.scrollWidth,height:target.scrollHeight}); const png=canvas.toDataURL('image/png'); const pdf=new window.jspdf.jsPDF(); pdf.addImage(png,'PNG',0,0,100,100); return {png:png.slice(0,30),pdf:pdf.output().slice(0,8),width:canvas.width,height:canvas.height}; })()`);
  assert.ok(exports.png.startsWith('data:image/png;base64,')); assert.ok(exports.pdf.startsWith('%PDF-'));
  const media = await run(`(async () => { const stream=await navigator.mediaDevices.getUserMedia({audio:true}); const tracks=stream.getTracks().map(t=>t.kind); stream.getTracks().forEach(t=>t.stop()); let videoDenied=false; try { const v=await navigator.mediaDevices.getUserMedia({video:true}); v.getTracks().forEach(t=>t.stop()); } catch {videoDenied=true;} return {tracks,videoDenied}; })()`);
  assert.deepEqual(media.tracks, ['audio']); assert.equal(media.videoDenied, true);
  const mp3 = await run(`(async () => { const w=new ArrayBuffer(44+44100*2),v=new DataView(w); function text(o,s){for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));} text(0,'RIFF'); v.setUint32(4,w.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,44100,true);v.setUint32(28,88200,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,w.byteLength-44,true);const out=await recordingAPI.toMp3(w);if(!out.ok)throw Error(out.error);const b=new Uint8Array(out.data);return {length:b.length,magic:String.fromCharCode(...b.slice(0,3))};})()`);
  assert.ok(mp3.length > 1000); assert.equal(mp3.magic, 'ID3');
  const invalid = await run(`recordingAPI.toMp3(new ArrayBuffer(44))`); assert.equal(invalid.ok, false);
  const preferences = mainWindow.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  const result = { initial, exports, media, mp3, invalidRejected: !invalid.ok, electron: process.versions.electron, chromium: process.versions.chrome, profile };
  fs.writeFileSync(path.join(evidence, 'electron-smoke.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2)); clearTimeout(timeout); electron.app.exit(0);
})().catch(error => { console.error(error.stack); clearTimeout(timeout); electron.app.exit(1); });
