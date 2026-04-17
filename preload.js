const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('api', {

  // ─── Storage ──────────────────────────────────────────────────────────────
  store: {
    get: (key, defaultValue) => ipcRenderer.invoke('store-get', key, defaultValue),
    set: (key, value) => ipcRenderer.invoke('store-set', key, value),
    delete: (key) => ipcRenderer.invoke('store-delete', key),
  },

  // ─── File System ──────────────────────────────────────────────────────────
  fs: {
    /** Check if a file exists on disk */
    exists: (filePath) => ipcRenderer.invoke('file-exists', filePath),

    /** Returns array of audio file paths from a folder */
    readFolder: (folderPath) => ipcRenderer.invoke('read-folder', folderPath),

    /** Open native file/folder picker. Returns array of paths or null */
    openDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),

    /** Convert absolute path to file:// URL usable by <audio> */
    toUrl: (filePath) => ipcRenderer.invoke('path-to-url', filePath),
  },

  // ─── Import / Export ──────────────────────────────────────────────────────
  data: {
    save: (data) => ipcRenderer.invoke('save-soundscape-file', data),
    load: () => ipcRenderer.invoke('load-soundscape-file'),
  },

  // ─── Window controls ──────────────────────────────────────────────────────
  win: {
    minimize:    () => ipcRenderer.invoke('window-minimize'),
    maximize:    () => ipcRenderer.invoke('window-maximize'),
    close:       () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  }
});
