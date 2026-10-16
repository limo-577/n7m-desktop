const { app, BrowserWindow, Menu, ipcMain, screen, dialog, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

let mainWindow = null;
let lyricWindow = null;

const MAIN_PAGE = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
const LYRIC_PAGE = pathToFileURL(path.join(__dirname, 'renderer', 'desktop-lyric.html')).href;

function isTrustedSender(event, window, expectedUrl) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents &&
    !!event.senderFrame && event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === expectedUrl;
}

// Only the main document needs microphone access; all other capabilities fail closed.
function isTrustedPermissionRequester(webContents, details) {
  return !!mainWindow && !mainWindow.isDestroyed() &&
    webContents === mainWindow.webContents && webContents.getURL() === MAIN_PAGE &&
    !!details && details.isMainFrame === true && details.requestingUrl === MAIN_PAGE;
}

function configurePermissions() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, origin, details) => {
    return isTrustedPermissionRequester(webContents, details) &&
      permission === 'media' && details.mediaType === 'audio';
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = details && details.mediaTypes;
    callback(isTrustedPermissionRequester(webContents, details) && permission === 'media' &&
      Array.isArray(mediaTypes) && mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio'));
  });
}

function rejectUnexpectedNavigation(window, expectedUrl) {
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== expectedUrl && !url.startsWith(expectedUrl + '#')) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (url !== expectedUrl && !url.startsWith(expectedUrl + '#')) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function isInsideDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

const stateFile = path.join(app.getPath('userData'), 'lyric-window-state.json');
function loadLyricState(){
  try{ return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch(e){ return { x: null, y: null, locked: false }; }
}
function saveLyricState(partial){
  const cur = loadLyricState();
  const next = Object.assign(cur, partial);
  try{ fs.writeFileSync(stateFile, JSON.stringify(next)); }catch(e){}
}

function createMainWindow () {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    title: 'N7m · 歌词标注 + 播放器',
    backgroundColor: '#20211f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  rejectUnexpectedNavigation(mainWindow, MAIN_PAGE);

  Menu.setApplicationMenu(null);

  // F12 随时打开/关闭开发者工具，方便排查问题
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (lyricWindow) { lyricWindow.close(); lyricWindow = null; }
  });

  // 如需排查问题可取消下一行注释，会自动打开开发者工具（也可以随时按 F12 手动开关）
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function createLyricWindow () {
  if (lyricWindow) { lyricWindow.show(); return; }

  const saved = loadLyricState();
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;
  const winW = 680, winH = 64; // 640→680：给新加的播放控制区多留一点初始宽度，之后仍可拖动改宽
  const x = (saved.x != null) ? saved.x : Math.round((width - winW) / 2);
  const y = (saved.y != null) ? saved.y : 60;

  lyricWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x, y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    movable: !saved.locked,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  rejectUnexpectedNavigation(lyricWindow, LYRIC_PAGE);

  lyricWindow.setAlwaysOnTop(true, 'screen-saver');
  lyricWindow.loadFile(path.join(__dirname, 'renderer', 'desktop-lyric.html'));

  let saveTimer = null;
  lyricWindow.on('moved', () => {
    const [px, py] = lyricWindow.getPosition();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveLyricState({ x: px, y: py }), 300);
  });

  lyricWindow.webContents.once('did-finish-load', () => {
    lyricWindow.webContents.send('style-update', { locked: saved.locked });
  });

  lyricWindow.on('closed', () => {
    lyricWindow = null;
    if (mainWindow) mainWindow.webContents.send('lyric-window-closed');
  });
}

app.whenReady().then(() => {
  configurePermissions();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ------ IPC：主窗口 <-> 桌面悬浮歌词窗口 ------
ipcMain.on('lyric-toggle', (event, payload) => {
  if (!isTrustedSender(event, mainWindow, MAIN_PAGE)) return;
  // 兼容两种用途：布尔值＝显示/隐藏悬浮窗；{kind:'lock', locked}＝锁定开关
  if (payload && typeof payload === 'object' && payload.kind === 'lock'){
    saveLyricState({ locked: !!payload.locked });
    if (lyricWindow) {
      lyricWindow.setMovable(!payload.locked);
      lyricWindow.webContents.send('lyric-update', { locked: !!payload.locked });
    }
    return;
  }
  if (payload) {
    createLyricWindow();
  } else if (lyricWindow) {
    lyricWindow.close();
    lyricWindow = null;
  }
});

ipcMain.on('lyric-update', (event, data) => {
  if (!isTrustedSender(event, mainWindow, MAIN_PAGE)) return;
  if (lyricWindow) lyricWindow.webContents.send('lyric-update', data);
});

ipcMain.on('lyric-window-close', (event) => {
  if (!isTrustedSender(event, lyricWindow, LYRIC_PAGE)) return;
  if (lyricWindow) { lyricWindow.close(); lyricWindow = null; }
});

// 悬浮窗请求切换"鼠标穿透"：ignore=true 时整个悬浮窗对鼠标不可见，点击会穿透到后面的内容；
// forward:true 让穿透状态下仍然把 mousemove 转发给悬浮窗，这样它才能判断鼠标有没有移到
// "解锁桌面歌词"按钮上，从而临时取消穿透以便点击。
ipcMain.on('lyric-set-ignore-mouse', (event, payload) => {
  if (!isTrustedSender(event, lyricWindow, LYRIC_PAGE)) return;
  if (!lyricWindow) return;
  const ignore = !!(payload && payload.ignore);
  const forward = !!(payload && payload.forward);
  lyricWindow.setIgnoreMouseEvents(ignore, { forward });
});

// 悬浮窗上的"锁定穿透"开关状态：锁定时顺手把窗口设为不可拖动，
// 解锁后再按设置面板里保存的"位置锁定"状态恢复是否可拖动。
ipcMain.on('lyric-passthrough', (event, payload) => {
  if (!isTrustedSender(event, lyricWindow, LYRIC_PAGE)) return;
  if (!lyricWindow) return;
  const locked = !!(payload && payload.locked);
  if (locked) {
    lyricWindow.setMovable(false);
  } else {
    const saved = loadLyricState();
    lyricWindow.setMovable(!saved.locked);
  }
});

// 悬浮窗上的上一曲 / 播放暂停 / 下一曲，转发给主窗口去真正执行
ipcMain.on('lyric-control', (event, payload) => {
  if (!isTrustedSender(event, lyricWindow, LYRIC_PAGE)) return;
  if (!payload || !['prev', 'next', 'toggle'].includes(payload.action)) return;
  if (mainWindow) mainWindow.webContents.send('lyric-control', payload);
});

// ------ 音频文件夹：用系统对话框选择，路径长期保存，下次启动自动可用 ------
const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.aac', '.opus', '.wma'];
const LRC_EXTS = ['.lrc'];

const folderFile = path.join(app.getPath('userData'), 'audio-folder.json');
function loadFolderPath(){
  try{ return JSON.parse(fs.readFileSync(folderFile, 'utf8')).dir || null; }
  catch(e){ return null; }
}
function saveFolderPath(dir){
  try{ fs.writeFileSync(folderFile, JSON.stringify({ dir })); }catch(e){}
}

function listFolder(dir){
  const out = { audio: [], lrc: [] };
  if (!dir) return out;
  let names = [];
  try{ names = fs.readdirSync(dir); }catch(e){ return out; }
  for (const name of names){
    const ext = path.extname(name).toLowerCase();
    const full = path.join(dir, name);
    try{ if (!fs.statSync(full).isFile()) continue; }catch(e){ continue; }
    if (AUDIO_EXTS.includes(ext)) out.audio.push({ name, path: full });
    else if (LRC_EXTS.includes(ext)) out.lrc.push({ name, path: full });
  }
  return out;
}

function resolveSelectedFile(filePath, allowedExtensions, maxBytes) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) return null;
  try {
    const selectedDir = loadFolderPath();
    if (!selectedDir) return null;
    const realDir = fs.realpathSync(selectedDir);
    const realFile = fs.realpathSync(path.resolve(filePath));
    if (!isInsideDirectory(realDir, realFile)) return null;
    if (!allowedExtensions.includes(path.extname(realFile).toLowerCase())) return null;
    const stat = fs.statSync(realFile);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return realFile;
  } catch (e) {
    return null;
  }
}

ipcMain.handle('audio-folder:get', (event) => {
  if (!isTrustedSender(event, mainWindow, MAIN_PAGE)) return { dir: null, audio: [], lrc: [] };
  const dir = loadFolderPath();
  if (!dir || !fs.existsSync(dir)) return { dir: null, audio: [], lrc: [] };
  return Object.assign({ dir }, listFolder(dir));
});

ipcMain.handle('audio-folder:pick', async (event) => {
  if (!isTrustedSender(event, mainWindow, MAIN_PAGE)) return { dir: null, audio: [], lrc: [] };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择存放音频和 LRC 歌词的文件夹',
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths[0]) return { dir: null, audio: [], lrc: [] };
  const dir = res.filePaths[0];
  saveFolderPath(dir);
  return Object.assign({ dir }, listFolder(dir));
});

ipcMain.handle('audio-folder:read', (event, filePath) => {
  if (!isTrustedSender(event, mainWindow, MAIN_PAGE)) return { ok: false, error: '不允许的调用来源' };
  try{
    const safePath = resolveSelectedFile(filePath, AUDIO_EXTS, 512 * 1024 * 1024);
    if (!safePath) return { ok: false, error: '只能读取所选文件夹内不超过 512 MiB 的音频文件' };
    const buf = fs.readFileSync(safePath);
    return { ok: true, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }catch(e){ return { ok: false, error: '读取音频文件失败' }; }
});

ipcMain.handle('audio-folder:readText', (event, filePath) => {
  if (!isTrustedSender(event, mainWindow, MAIN_PAGE)) return { ok: false, error: '不允许的调用来源' };
  try{
    const safePath = resolveSelectedFile(filePath, LRC_EXTS, 5 * 1024 * 1024);
    if (!safePath) return { ok: false, error: '只能读取所选文件夹内不超过 5 MiB 的 LRC 文件' };
    return { ok: true, text: fs.readFileSync(safePath, 'utf8') };
  } catch(e){ return { ok: false, error: '读取 LRC 文件失败' }; }
});

// ------ 录音转 MP3：渲染进程只负责录音/拼成 WAV，真正的 MP3 编码交给 ffmpeg ------
// 运行和打包前由 scripts/ensure-ffmpeg.js 校验项目内置的固定版本 FFmpeg。
let cachedFfmpegPath = null;
let recordingConversionActive = false;
function resolveFfmpegPath(){
  if (cachedFfmpegPath) return cachedFfmpegPath;
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('当前版本只包含 Windows x64 的内置 FFmpeg');
  }
  const ffmpegPath = app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
    : path.join(__dirname, 'resources', 'ffmpeg', 'ffmpeg.exe');
  if (!fs.existsSync(ffmpegPath)) {
    throw new Error('内置 FFmpeg 不存在或未通过校验，请恢复项目内的发行文件后重试');
  }
  cachedFfmpegPath = ffmpegPath;
  return cachedFfmpegPath;
}

function isExpectedPcmWav(arrayBuffer) {
  const wav = Buffer.from(arrayBuffer);
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' ||
      wav.toString('ascii', 8, 12) !== 'WAVE' ||
      wav.toString('ascii', 12, 16) !== 'fmt ' ||
      wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 ||
      wav.toString('ascii', 36, 40) !== 'data') return false;

  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const byteRate = wav.readUInt32LE(28);
  const blockAlign = wav.readUInt16LE(32);
  const bitsPerSample = wav.readUInt16LE(34);
  const dataSize = wav.readUInt32LE(40);
  const expectedBlockAlign = channels * 2;

  return wav.readUInt32LE(4) === wav.length - 8 &&
    channels >= 1 && channels <= 32 &&
    sampleRate >= 8000 && sampleRate <= 384000 &&
    bitsPerSample === 16 && blockAlign === expectedBlockAlign &&
    byteRate === sampleRate * expectedBlockAlign &&
    dataSize > 0 && dataSize === wav.length - 44 &&
    dataSize % expectedBlockAlign === 0;
}

ipcMain.handle('recording:to-mp3', async (event, arrayBuffer) => {
  if (!isTrustedSender(event, mainWindow, MAIN_PAGE)) return { ok: false, error: '不允许的调用来源' };
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
    return { ok: false, error: '录音数据无效' };
  }
  if (arrayBuffer.byteLength > 256 * 1024 * 1024) {
    return { ok: false, error: '录音文件不能超过 256 MiB' };
  }
  if (!isExpectedPcmWav(arrayBuffer)) {
    return { ok: false, error: '录音数据必须是标准 16-bit PCM WAV' };
  }
  if (recordingConversionActive) return { ok: false, error: '已有录音正在转码' };
  recordingConversionActive = true;
  let tempDir = null;
  try{
    const ffmpegPath = resolveFfmpegPath();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n7m-rec-' + crypto.randomBytes(12).toString('hex') + '-'));
    const wavPath = path.join(tempDir, 'recording.wav');
    const mp3Path = path.join(tempDir, 'recording.mp3');
    fs.writeFileSync(wavPath, Buffer.from(arrayBuffer));
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, ['-nostdin', '-y', '-protocol_whitelist', 'file',
        '-f', 'wav', '-c:a', 'pcm_s16le', '-i', wavPath,
        '-codec:a', 'libmp3lame', '-b:a', '192k', mp3Path], {
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message || err).slice(0, 500)));
        else resolve();
      });
    });
    const buf = fs.readFileSync(mp3Path);
    return { ok: true, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }catch(e){
    return { ok: false, error: '录音转码失败，请检查录音数据后重试' };
  }finally{
    if (tempDir) try{ fs.rmSync(tempDir, { recursive: true, force: true }); }catch(e){}
    recordingConversionActive = false;
  }
});
