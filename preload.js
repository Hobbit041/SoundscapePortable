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
    save: (data, defaultName) => ipcRenderer.invoke('save-soundscape-file', data, defaultName),
    load: () => ipcRenderer.invoke('load-soundscape-file'),
  },

  // ─── MIDI mapping import / export ─────────────────────────────────────────
  midi: {
    saveMappings: (data) => ipcRenderer.invoke('save-midi-file', data),
    loadMappings: () => ipcRenderer.invoke('load-midi-file'),
  },

  // ─── Profiles import / export ─────────────────────────────────────────────
  profiles: {
    save: (data) => ipcRenderer.invoke('save-profiles-file', data),
    load: () => ipcRenderer.invoke('load-profiles-file'),
  },

  // ─── Window controls ──────────────────────────────────────────────────────
  win: {
    minimize:    () => ipcRenderer.invoke('window-minimize'),
    maximize:    () => ipcRenderer.invoke('window-maximize'),
    close:       () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  },

  // ─── Crash log ────────────────────────────────────────────────────────────
  log: {
    crash:      (source, message, stack, detail) => ipcRenderer.invoke('log-crash', source, message, stack, detail),
    getPath:    () => ipcRenderer.invoke('get-log-path'),
    openFolder: () => ipcRenderer.invoke('open-log-folder'),
  },

  // ─── Translations ─────────────────────────────────────────────────────────
  getI18n: () => ipcRenderer.invoke('get-i18n'),
});
