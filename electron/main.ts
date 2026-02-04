import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chokidar from 'chokidar';
import MiniSearch from 'minisearch';

type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
};

type NoteIndexEntry = {
  path: string;
  title: string;
  content: string;
  links: string[];
};

type Settings = {
  lastVault?: string;
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let mainWindow: BrowserWindow | null = null;
let vaultPath: string | null = null;
let watcher: chokidar.FSWatcher | null = null;
let noteIndex = new Map<string, NoteIndexEntry>();
let titleToPath = new Map<string, string>();
let backlinks = new Map<string, Set<string>>();
let searchIndex = new MiniSearch<NoteIndexEntry>({
  fields: ['title', 'content'],
  storeFields: ['title', 'path'],
  idField: 'path'
});

const normalizeTitle = (value: string) => value.trim().toLowerCase();
const noteTitleFromPath = (filePath: string) => path.basename(filePath, path.extname(filePath));

const parseWikiLinks = (content: string) => {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match = regex.exec(content);
  while (match) {
    links.push(normalizeTitle(match[1]));
    match = regex.exec(content);
  }
  return links;
};

const loadSettings = async (): Promise<Settings> => {
  const filePath = settingsPath();
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as Settings;
  } catch {
    return {};
  }
};

const saveSettings = async (settings: Settings) => {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
};

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

const getAllMarkdownFiles = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await getAllMarkdownFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
};

const buildTree = async (dir: string): Promise<TreeNode[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'folder',
        children: await buildTree(fullPath)
      });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'file'
      });
    }
  }
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
};

const indexFile = async (filePath: string) => {
  if (!vaultPath) {
    return;
  }
  if (!filePath.toLowerCase().endsWith('.md')) {
    return;
  }
  const content = await fs.readFile(filePath, 'utf-8');
  const title = noteTitleFromPath(filePath);
  const normalizedTitle = normalizeTitle(title);
  const links = parseWikiLinks(content);
  const entry: NoteIndexEntry = { path: filePath, title, content, links };
  noteIndex.set(filePath, entry);
  titleToPath.set(normalizedTitle, filePath);
};

const rebuildBacklinks = () => {
  backlinks = new Map();
  for (const entry of noteIndex.values()) {
    for (const link of entry.links) {
      const targetPath = titleToPath.get(link);
      if (!targetPath) {
        continue;
      }
      if (!backlinks.has(targetPath)) {
        backlinks.set(targetPath, new Set());
      }
      backlinks.get(targetPath)?.add(entry.path);
    }
  }
};

const rebuildSearchIndex = () => {
  searchIndex = new MiniSearch<NoteIndexEntry>({
    fields: ['title', 'content'],
    storeFields: ['title', 'path'],
    idField: 'path'
  });
  const docs = Array.from(noteIndex.values());
  searchIndex.addAll(docs);
};

const buildIndexes = async () => {
  if (!vaultPath) {
    return;
  }
  noteIndex = new Map();
  titleToPath = new Map();
  const files = await getAllMarkdownFiles(vaultPath);
  await Promise.all(files.map((file) => indexFile(file)));
  rebuildBacklinks();
  rebuildSearchIndex();
};

const updateIndexForFile = async (filePath: string) => {
  await indexFile(filePath);
  rebuildBacklinks();
  rebuildSearchIndex();
};

const removeIndexForFile = (filePath: string) => {
  noteIndex.delete(filePath);
  const title = noteTitleFromPath(filePath);
  titleToPath.delete(normalizeTitle(title));
  rebuildBacklinks();
  rebuildSearchIndex();
};

const startWatcher = () => {
  if (!vaultPath) {
    return;
  }
  watcher?.close();
  watcher = chokidar.watch(vaultPath, { ignoreInitial: true });
  watcher.on('add', async (filePath) => {
    if (filePath.toLowerCase().endsWith('.md')) {
      await updateIndexForFile(filePath);
      mainWindow?.webContents.send('vault:changed');
    }
  });
  watcher.on('change', async (filePath) => {
    if (filePath.toLowerCase().endsWith('.md')) {
      await updateIndexForFile(filePath);
      mainWindow?.webContents.send('vault:changed');
    }
  });
  watcher.on('unlink', (filePath) => {
    if (filePath.toLowerCase().endsWith('.md')) {
      removeIndexForFile(filePath);
      mainWindow?.webContents.send('vault:changed');
    }
  });
  watcher.on('addDir', () => mainWindow?.webContents.send('vault:changed'));
  watcher.on('unlinkDir', () => mainWindow?.webContents.send('vault:changed'));
};

const ensureVaultSet = () => {
  if (!vaultPath) {
    throw new Error('Vault not set');
  }
};

ipcMain.handle('vault:getLast', async () => {
  const settings = await loadSettings();
  return settings.lastVault ?? null;
});

ipcMain.handle('vault:select', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  vaultPath = result.filePaths[0];
  await saveSettings({ lastVault: vaultPath });
  await buildIndexes();
  startWatcher();
  return vaultPath;
});

ipcMain.handle('vault:set', async (_event, newVaultPath: string) => {
  vaultPath = newVaultPath;
  await saveSettings({ lastVault: vaultPath });
  await buildIndexes();
  startWatcher();
  return vaultPath;
});

ipcMain.handle('vault:getTree', async () => {
  ensureVaultSet();
  return buildTree(vaultPath!);
});

ipcMain.handle('file:read', async (_event, filePath: string) => {
  ensureVaultSet();
  return fs.readFile(filePath, 'utf-8');
});

ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
  ensureVaultSet();
  await fs.writeFile(filePath, content, 'utf-8');
  await updateIndexForFile(filePath);
});

ipcMain.handle('file:create', async (_event, targetPath: string, content = '') => {
  ensureVaultSet();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf-8');
  await updateIndexForFile(targetPath);
});

ipcMain.handle('folder:create', async (_event, targetPath: string) => {
  ensureVaultSet();
  await fs.mkdir(targetPath, { recursive: true });
});

ipcMain.handle('entry:rename', async (_event, sourcePath: string, targetPath: string) => {
  ensureVaultSet();
  await fs.rename(sourcePath, targetPath);
  if (sourcePath.toLowerCase().endsWith('.md')) {
    removeIndexForFile(sourcePath);
  }
  if (targetPath.toLowerCase().endsWith('.md')) {
    await updateIndexForFile(targetPath);
  }
});

ipcMain.handle('entry:delete', async (_event, targetPath: string) => {
  ensureVaultSet();
  await fs.rm(targetPath, { recursive: true, force: true });
  if (targetPath.toLowerCase().endsWith('.md')) {
    removeIndexForFile(targetPath);
  }
});

ipcMain.handle('search:query', async (_event, query: string) => {
  if (!query.trim()) {
    return [];
  }
  const results = searchIndex.search(query, { prefix: true, fuzzy: 0.2 });
  return results.slice(0, 50);
});

ipcMain.handle('note:openByTitle', async (_event, title: string) => {
  const target = titleToPath.get(normalizeTitle(title));
  return target ?? null;
});

ipcMain.handle('note:exists', async (_event, title: string) => {
  return titleToPath.has(normalizeTitle(title));
});

ipcMain.handle('backlinks:get', async (_event, filePath: string) => {
  const links = backlinks.get(filePath);
  if (!links) {
    return [];
  }
  return Array.from(links);
});

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
