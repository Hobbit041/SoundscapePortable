const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store();

// ─── Translations ─────────────────────────────────────────────────────────────
const _translations = require(path.join(__dirname, 'translations', 'ru.json'));
const nd = _translations.nativeDialogs;

// Remove default application menu
Menu.setApplicationMenu(null);

// ─── Crash logger ─────────────────────────────────────────────────────────────

const LOG_PATH     = path.join(app.getPath('userData'), 'crash.log');
const MAX_LOG_SIZE = 200 * 1024; // 200 KB — trim when exceeded

function writeLog(entry) {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > MAX_LOG_SIZE) {
      const content = fs.readFileSync(LOG_PATH, 'utf8');
      fs.writeFileSync(LOG_PATH, content.slice(Math.floor(content.length / 2)), 'utf8');
    }
    fs.appendFileSync(LOG_PATH, entry + '\n', 'utf8');
  } catch (_) {}
}

function formatCrash(source, message, stack, detail) {
  const ts    = new Date().toISOString();
  const lines = [`[${ts}] [${source}] ${message}`];
  if (detail) lines.push(`  at ${detail}`);
  if (stack)  lines.push(stack);
  lines.push('');
  return lines.join('\n');
}

process.on('uncaughtException',  (err) => writeLog(formatCrash('MAIN', err.message, err.stack, '')));
process.on('unhandledRejection', (reason) => {
  const msg   = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? (reason.stack ?? '') : '';
  writeLog(formatCrash('MAIN/PROMISE', msg, stack, ''));
});

// ─────────────────────────────────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1042,
    height: 600,
    minWidth: 1000,
    minHeight: 530,
    backgroundColor: '#1a1a1e',
    title: 'Soundscapes',
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow local audio files to be loaded
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  writeLog(`\n${'='.repeat(60)}\nSession started ${new Date().toISOString()}\n${'='.repeat(60)}`);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Window controls IPC ─────────────────────────────────────────────────────

ipcMain.handle('window-minimize',   () => mainWindow?.minimize());
ipcMain.handle('window-maximize',   () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close',      () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

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
        ? [{ name: nd.imageFilesFilter, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
        : [{ name: nd.audioFilesFilter, extensions: ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'opus', 'webm'] }]
  });
  if (result.canceled) return null;
  return result.filePaths.map(p => p.replace(/\\/g, '/'));
});

// Save a .soundscapeData file
ipcMain.handle('save-soundscape-file', async (_, data, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: nd.exportSoundscapeTitle,
    defaultPath: (defaultName || 'soundscape') + '.soundscapeData',
    filters: [{ name: nd.soundscapeDataFilter, extensions: ['soundscapeData'] }]
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return true;
});

// Load a .soundscapeData file
ipcMain.handle('load-soundscape-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: nd.importSoundscapeTitle,
    filters: [{ name: nd.soundscapeDataFilter, extensions: ['soundscapeData', 'json'] }],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  const raw = fs.readFileSync(result.filePaths[0], 'utf8');
  return JSON.parse(raw);
});

// Save a .midimap file
ipcMain.handle('save-midi-file', async (_, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: nd.exportMidiTitle,
    defaultPath: 'midi-mapping.midimap',
    filters: [{ name: nd.midiMappingFilter, extensions: ['midimap'] }]
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return true;
});

// Load a .midimap file
ipcMain.handle('load-midi-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: nd.importMidiTitle,
    filters: [{ name: nd.midiMappingFilter, extensions: ['midimap', 'json'] }],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  const raw = fs.readFileSync(result.filePaths[0], 'utf8');
  return JSON.parse(raw);
});

// ─── Crash log IPC ───────────────────────────────────────────────────────────

ipcMain.handle('log-crash', (_, source, message, stack, detail) => {
  writeLog(formatCrash(source, message, stack, detail));
});

ipcMain.handle('get-log-path', () => LOG_PATH);

ipcMain.handle('open-log-folder', () => shell.showItemInFolder(LOG_PATH));

// ─── i18n IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle('get-i18n', () => _translations);

// Convert a local file path to a file:// URL for the audio element
ipcMain.handle('path-to-url', (_, filePath) => {
  if (!filePath) return '';
  // Already a URL
  if (filePath.startsWith('http') || filePath.startsWith('file://')) return filePath;
  return 'file:///' + filePath.replace(/\\/g, '/').replace(/^\//, '');
});
