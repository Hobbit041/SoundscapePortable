const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    title: 'Soundscape',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow local audio files to be loaded
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Storage IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('store-get', (_, key, defaultValue) => {
  return store.get(key, defaultValue);
});

ipcMain.handle('store-set', (_, key, value) => {
  store.set(key, value);
});

ipcMain.handle('store-delete', (_, key) => {
  store.delete(key);
});

// ─── File System IPC ─────────────────────────────────────────────────────────

// Check if a file exists
ipcMain.handle('file-exists', (_, filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
});

// Read all audio files from a folder
ipcMain.handle('read-folder', (_, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) return [];
    const audioExtensions = ['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.opus', '.webm'];
    const files = fs.readdirSync(folderPath);
    return files
      .filter(f => audioExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => path.join(folderPath, f).replace(/\\/g, '/'));
  } catch {
    return [];
  }
});

// Open a native file picker dialog
ipcMain.handle('open-file-dialog', async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: options?.folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
    filters: options?.folder
      ? []
      : options?.images
        ? [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
        : [{ name: 'Audio Files', extensions: ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'opus', 'webm'] }]
  });
  if (result.canceled) return null;
  return result.filePaths.map(p => p.replace(/\\/g, '/'));
});

// Save a .soundscapeData file
ipcMain.handle('save-soundscape-file', async (_, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Soundscape',
    defaultPath: 'soundscape.soundscapeData',
    filters: [{ name: 'Soundscape Data', extensions: ['soundscapeData'] }]
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return true;
});

// Load a .soundscapeData file
ipcMain.handle('load-soundscape-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Soundscape',
    filters: [{ name: 'Soundscape Data', extensions: ['soundscapeData', 'json'] }],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  const raw = fs.readFileSync(result.filePaths[0], 'utf8');
  return JSON.parse(raw);
});

// Convert a local file path to a file:// URL for the audio element
ipcMain.handle('path-to-url', (_, filePath) => {
  if (!filePath) return '';
  // Already a URL
  if (filePath.startsWith('http') || filePath.startsWith('file://')) return filePath;
  return 'file:///' + filePath.replace(/\\/g, '/').replace(/^\//, '');
});
