const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopLyricBridge', {
  // 主窗口调用：把当前歌词文字/样式发给桌面悬浮歌词窗口
  send: (channel, data) => {
    const allowed = ['lyric-update', 'lyric-toggle', 'lyric-window-close', 'lyric-window-set-movable',
      'lyric-set-ignore-mouse', 'lyric-passthrough', 'lyric-control'];
    if (allowed.includes(channel)) ipcRenderer.send(channel, data);
  },
  // 悬浮歌词窗口调用：接收主窗口发来的更新；主窗口调用：监听悬浮窗被关闭
  on: (channel, callback) => {
    const allowed = ['lyric-update', 'lyric-window-closed', 'lyric-control'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (event, data) => callback(data));
    }
  }
});

// 音频文件夹：路径长期保存在本地，下次启动自动可用，不用每次重新导入
contextBridge.exposeInMainWorld('audioFolderAPI', {
  get: () => ipcRenderer.invoke('audio-folder:get'),
  pick: () => ipcRenderer.invoke('audio-folder:pick'),
  readFile: (p) => ipcRenderer.invoke('audio-folder:read', p),
  readText: (p) => ipcRenderer.invoke('audio-folder:readText', p)
});

// 录音转 MP3：渲染进程把录好的 WAV 数据传过来，主进程调用 ffmpeg 转码后把 MP3 数据传回去
contextBridge.exposeInMainWorld('recordingAPI', {
  toMp3: (arrayBuffer) => ipcRenderer.invoke('recording:to-mp3', arrayBuffer)
});
