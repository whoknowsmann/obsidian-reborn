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
  lastModified: number;
  lowerTitle: string;
  lowerPath: string;
};

type Settings = {
  lastVault?: string;
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let mainWindow: BrowserWindow | null = null;
let vaultPath: string | null = null;
let watcher: chokidar.FSWatcher | null = null;

const normalizeTitle = (value: string) => value.trim().toLowerCase();
const noteTitleFromPath = (filePath: string) => path.basename(filePath, path.extname(filePath));
const fuzzyScore = (query: string, target: string) => {
  if (!query) {
    return 0;
  }
  let score = 0;
  let lastMatch = -1;
  for (const char of query) {
    const index = target.indexOf(char, lastMatch + 1);
    if (index === -1) {
      return 0;
    }
    score += index === lastMatch + 1 ? 2 : 1;
    lastMatch = index;
  }
  return score / Math.max(target.length, 1);
};

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

class VaultIndex {
  private notes = new Map<string, NoteIndexEntry>();
  private titleToPath = new Map<string, string>();
  private backlinks = new Map<string, Set<string>>();
  private searchIndex = new MiniSearch<NoteIndexEntry>({
    fields: ['title', 'content'],
    storeFields: ['title', 'path'],
    idField: 'path'
  });
  private vaultPath: string | null = null;

  setVaultPath(nextVaultPath: string) {
    this.vaultPath = nextVaultPath;
  }

  getNoteSummaries() {
    return Array.from(this.notes.values()).map((entry) => ({
      path: entry.path,
      title: entry.title,
      lastModified: entry.lastModified
    }));
  }

  openByTitle(title: string) {
    return this.titleToPath.get(normalizeTitle(title)) ?? null;
  }

  noteExists(title: string) {
    return this.titleToPath.has(normalizeTitle(title));
  }

  getBacklinks(filePath: string) {
    const links = this.backlinks.get(filePath);
    if (!links) {
      return [];
    }
    return Array.from(links);
  }

  search(query: string) {
    if (!query.trim()) {
      return [];
    }
    return this.searchIndex.search(query, { prefix: true, fuzzy: 0.2 }).slice(0, 50);
  }

  searchNotes(query: string) {
    const normalized = normalizeTitle(query);
    if (!normalized) {
      return { results: [], hasExactMatch: false };
    }
    let hasExactMatch = false;
    const scored = Array.from(this.notes.values())
      .map((entry) => {
        if (entry.lowerTitle === normalized) {
          hasExactMatch = true;
        }
        const titleScore = fuzzyScore(normalized, entry.lowerTitle);
        const pathScore = fuzzyScore(normalized, entry.lowerPath);
        return {
          entry,
          titleScore,
          pathScore,
          score: Math.max(titleScore, pathScore)
        };
      })
      .filter((item) => item.score > 0);
    scored.sort((a, b) => {
      const aTitle = a.titleScore > 0;
      const bTitle = b.titleScore > 0;
      if (aTitle !== bTitle) {
        return aTitle ? -1 : 1;
      }
      if (aTitle && bTitle && a.titleScore !== b.titleScore) {
        return b.titleScore - a.titleScore;
      }
      if (a.pathScore !== b.pathScore) {
        return b.pathScore - a.pathScore;
      }
      return a.entry.title.localeCompare(b.entry.title);
    });
    const results = scored.slice(0, 50).map((item) => ({
      id: item.entry.path,
      title: item.entry.title,
      path: item.entry.path,
      displayPath: this.vaultPath ? path.relative(this.vaultPath, item.entry.path) : item.entry.path,
      score: item.score
    }));
    return { results, hasExactMatch };
  }

  async build() {
    if (!this.vaultPath) {
      return;
    }
    this.notes = new Map();
    this.titleToPath = new Map();
    this.backlinks = new Map();
    this.searchIndex = new MiniSearch<NoteIndexEntry>({
      fields: ['title', 'content'],
      storeFields: ['title', 'path'],
      idField: 'path'
    });
    const files = await getAllMarkdownFiles(this.vaultPath);
    await Promise.all(files.map((file) => this.indexFile(file, false)));
    this.rebuildBacklinks();
    this.rebuildSearchIndex();
  }

  async updateFile(filePath: string) {
    await this.indexFile(filePath, true);
    this.rebuildBacklinks();
    this.rebuildSearchIndex();
  }

  removeFile(filePath: string) {
    const existing = this.notes.get(filePath);
    if (!existing) {
      return;
    }
    this.notes.delete(filePath);
    this.titleToPath.delete(existing.lowerTitle);
    this.rebuildBacklinks();
    this.rebuildSearchIndex();
  }

  private async indexFile(filePath: string, updateTitleMap: boolean) {
    if (!this.vaultPath) {
      return;
    }
    if (!filePath.toLowerCase().endsWith('.md')) {
      return;
    }
    const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf-8'), fs.stat(filePath)]);
    const title = noteTitleFromPath(filePath);
    const normalizedTitle = normalizeTitle(title);
    if (updateTitleMap) {
      const existing = this.notes.get(filePath);
      if (existing) {
        this.titleToPath.delete(existing.lowerTitle);
      }
    }
    const links = parseWikiLinks(content);
    const entry: NoteIndexEntry = {
      path: filePath,
      title,
      content,
      links,
      lastModified: stats.mtimeMs,
      lowerTitle: normalizedTitle,
      lowerPath: path.relative(this.vaultPath, filePath).toLowerCase()
    };
    this.notes.set(filePath, entry);
    this.titleToPath.set(normalizedTitle, filePath);
  }

  private rebuildBacklinks() {
    this.backlinks = new Map();
    for (const entry of this.notes.values()) {
      for (const link of entry.links) {
        const targetPath = this.titleToPath.get(link);
        if (!targetPath) {
          continue;
        }
        if (!this.backlinks.has(targetPath)) {
          this.backlinks.set(targetPath, new Set());
        }
        this.backlinks.get(targetPath)?.add(entry.path);
      }
    }
  }

  private rebuildSearchIndex() {
    this.searchIndex = new MiniSearch<NoteIndexEntry>({
      fields: ['title', 'content'],
      storeFields: ['title', 'path'],
      idField: 'path'
    });
    const docs = Array.from(this.notes.values());
    this.searchIndex.addAll(docs);
  }
}

const vaultIndex = new VaultIndex();

const startWatcher = () => {
  if (!vaultPath) {
    return;
  }
  watcher?.close();
  watcher = chokidar.watch(vaultPath, { ignoreInitial: true });
  watcher.on('add', async (filePath) => {
    if (filePath.toLowerCase().endsWith('.md')) {
      await vaultIndex.updateFile(filePath);
      mainWindow?.webContents.send('vault:changed');
    }
  });
  watcher.on('change', async (filePath) => {
    if (filePath.toLowerCase().endsWith('.md')) {
      await vaultIndex.updateFile(filePath);
      mainWindow?.webContents.send('vault:changed');
    }
  });
  watcher.on('unlink', (filePath) => {
    if (filePath.toLowerCase().endsWith('.md')) {
      vaultIndex.removeFile(filePath);
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
  vaultIndex.setVaultPath(vaultPath);
  await saveSettings({ lastVault: vaultPath });
  await vaultIndex.build();
  startWatcher();
  return vaultPath;
});

ipcMain.handle('vault:set', async (_event, newVaultPath: string) => {
  vaultPath = newVaultPath;
  vaultIndex.setVaultPath(vaultPath);
  await saveSettings({ lastVault: vaultPath });
  await vaultIndex.build();
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
  await vaultIndex.updateFile(filePath);
});

ipcMain.handle('file:create', async (_event, targetPath: string, content = '') => {
  ensureVaultSet();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf-8');
  await vaultIndex.updateFile(targetPath);
});

ipcMain.handle('folder:create', async (_event, targetPath: string) => {
  ensureVaultSet();
  await fs.mkdir(targetPath, { recursive: true });
});

ipcMain.handle('entry:rename', async (_event, sourcePath: string, targetPath: string) => {
  ensureVaultSet();
  await fs.rename(sourcePath, targetPath);
  if (sourcePath.toLowerCase().endsWith('.md')) {
    vaultIndex.removeFile(sourcePath);
  }
  if (targetPath.toLowerCase().endsWith('.md')) {
    await vaultIndex.updateFile(targetPath);
  }
});

ipcMain.handle('entry:delete', async (_event, targetPath: string) => {
  ensureVaultSet();
  await fs.rm(targetPath, { recursive: true, force: true });
  if (targetPath.toLowerCase().endsWith('.md')) {
    vaultIndex.removeFile(targetPath);
  }
});

ipcMain.handle('search:query', async (_event, query: string) => {
  return vaultIndex.search(query);
});

ipcMain.handle('note:quickSwitch', async (_event, query: string) => vaultIndex.searchNotes(query));

ipcMain.handle('note:openByTitle', async (_event, title: string) => {
  return vaultIndex.openByTitle(title);
});

ipcMain.handle('note:exists', async (_event, title: string) => {
  return vaultIndex.noteExists(title);
});

ipcMain.handle('backlinks:get', async (_event, filePath: string) => {
  return vaultIndex.getBacklinks(filePath);
});

ipcMain.handle('vault:hasDailyFolder', async () => {
  if (!vaultPath) {
    return false;
  }
  const dailyPath = path.join(vaultPath, 'Daily');
  try {
    const stats = await fs.stat(dailyPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
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
