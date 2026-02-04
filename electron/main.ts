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

type RenamePreview = {
  sourcePath: string;
  targetPath: string;
  oldTitle: string;
  newTitle: string;
  affectedFiles: string[];
};

type RenameApplyResult = {
  ok: boolean;
  error?: string;
  sourcePath: string;
  targetPath: string;
  updatedFiles: string[];
  failedFiles: string[];
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

const wikiLinkRegex = /(!?)\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;

const parseWikiLinks = (content: string) => {
  const links: string[] = [];
  wikiLinkRegex.lastIndex = 0;
  let match = wikiLinkRegex.exec(content);
  while (match) {
    links.push(normalizeTitle(match[2]));
    match = wikiLinkRegex.exec(content);
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

const rebuildDerivedIndexes = () => {
  rebuildBacklinks();
  rebuildSearchIndex();
};

const buildIndexes = async () => {
  if (!vaultPath) {
    return;
  }
  noteIndex = new Map();
  titleToPath = new Map();
  const files = await getAllMarkdownFiles(vaultPath);
  await Promise.all(files.map((file) => indexFile(file)));
  rebuildDerivedIndexes();
};

const updateIndexForFile = async (filePath: string) => {
  await indexFile(filePath);
  rebuildDerivedIndexes();
};

const removeIndexForFile = (filePath: string) => {
  noteIndex.delete(filePath);
  const title = noteTitleFromPath(filePath);
  titleToPath.delete(normalizeTitle(title));
  rebuildDerivedIndexes();
};

const isMarkdownFile = (filePath: string) => filePath.toLowerCase().endsWith('.md');

const resolveTitle = (title: string, map: Map<string, string>) =>
  map.get(normalizeTitle(title)) ?? null;

const getAffectedFilesForRename = (sourcePath: string) => {
  const links = backlinks.get(sourcePath);
  if (!links) {
    return [];
  }
  return Array.from(links).sort((a, b) => a.localeCompare(b));
};

const updateWikiLinksInContent = (
  content: string,
  sourcePath: string,
  newTitle: string,
  titleMap: Map<string, string>
) => {
  wikiLinkRegex.lastIndex = 0;
  return content.replace(wikiLinkRegex, (match, embed, target, alias) => {
    const resolved = resolveTitle(target, titleMap);
    if (resolved !== sourcePath) {
      return match;
    }
    return `${embed}[[${newTitle}${alias ?? ''}]]`;
  });
};

const checkRenameConflict = async (sourcePath: string, targetPath: string) => {
  if (sourcePath === targetPath) {
    return;
  }
  const normalizedSource = path.resolve(sourcePath);
  const normalizedTarget = path.resolve(targetPath);
  const isCaseOnlyChange =
    normalizedSource.toLowerCase() === normalizedTarget.toLowerCase() &&
    normalizedSource !== normalizedTarget;
  if (existsSync(targetPath) && !(isCaseOnlyChange && ['win32', 'darwin'].includes(process.platform))) {
    throw new Error(`Cannot rename: "${targetPath}" already exists.`);
  }
};

const renamePathSafe = async (sourcePath: string, targetPath: string) => {
  if (sourcePath === targetPath) {
    return;
  }
  const normalizedSource = path.resolve(sourcePath);
  const normalizedTarget = path.resolve(targetPath);
  const isCaseOnlyChange =
    normalizedSource.toLowerCase() === normalizedTarget.toLowerCase() &&
    normalizedSource !== normalizedTarget &&
    ['win32', 'darwin'].includes(process.platform);
  if (isCaseOnlyChange) {
    const tempPath = `${targetPath}.tmp-${Date.now()}`;
    await fs.rename(sourcePath, tempPath);
    await fs.rename(tempPath, targetPath);
    return;
  }
  await fs.rename(sourcePath, targetPath);
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
  await checkRenameConflict(sourcePath, targetPath);
  await renamePathSafe(sourcePath, targetPath);
  if (isMarkdownFile(sourcePath)) {
    removeIndexForFile(sourcePath);
  }
  if (isMarkdownFile(targetPath)) {
    await updateIndexForFile(targetPath);
  }
});

ipcMain.handle(
  'entry:prepareRename',
  async (_event, sourcePath: string, targetPath: string): Promise<RenamePreview> => {
    ensureVaultSet();
    const oldTitle = noteTitleFromPath(sourcePath);
    const newTitle = noteTitleFromPath(targetPath);
    const affectedFiles = isMarkdownFile(sourcePath) ? getAffectedFilesForRename(sourcePath) : [];
    return { sourcePath, targetPath, oldTitle, newTitle, affectedFiles };
  }
);

ipcMain.handle(
  'entry:applyRename',
  async (_event, sourcePath: string, targetPath: string): Promise<RenameApplyResult> => {
    ensureVaultSet();
    const updatedFiles: string[] = [];
    const failedFiles: string[] = [];
    try {
      await checkRenameConflict(sourcePath, targetPath);
      await renamePathSafe(sourcePath, targetPath);
      if (!isMarkdownFile(sourcePath)) {
        return { ok: true, sourcePath, targetPath, updatedFiles, failedFiles };
      }
      const oldTitle = noteTitleFromPath(sourcePath);
      const newTitle = noteTitleFromPath(targetPath);
      const titleMapSnapshot = new Map(titleToPath);
      const affectedFiles = getAffectedFilesForRename(sourcePath);
      const shouldUpdateLinks = oldTitle !== newTitle;
      const pathsToUpdate = shouldUpdateLinks ? affectedFiles : [];
      const adjustedPaths = pathsToUpdate.map((filePath) =>
        filePath === sourcePath ? targetPath : filePath
      );
      for (let index = 0; index < adjustedPaths.length; index += 1) {
        const filePath = adjustedPaths[index];
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const nextContent = updateWikiLinksInContent(content, sourcePath, newTitle, titleMapSnapshot);
          if (nextContent !== content) {
            await fs.writeFile(filePath, nextContent, 'utf-8');
          }
          updatedFiles.push(filePath);
        } catch (error) {
          failedFiles.push(filePath);
          const remaining = adjustedPaths.slice(index + 1);
          failedFiles.push(...remaining);
          throw error;
        }
      }
      noteIndex.delete(sourcePath);
      titleToPath.delete(normalizeTitle(oldTitle));
      const pathsToIndex = new Set([targetPath, ...adjustedPaths]);
      for (const filePath of pathsToIndex) {
        if (isMarkdownFile(filePath)) {
          await indexFile(filePath);
        }
      }
      rebuildDerivedIndexes();
      return { ok: true, sourcePath, targetPath, updatedFiles, failedFiles };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error during rename.',
        sourcePath,
        targetPath,
        updatedFiles,
        failedFiles
      };
    }
  }
);

ipcMain.handle('entry:delete', async (_event, targetPath: string) => {
  ensureVaultSet();
  await fs.rm(targetPath, { recursive: true, force: true });
  if (isMarkdownFile(targetPath)) {
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

ipcMain.handle('note:searchTitles', async (_event, query: string) => {
  if (!query.trim()) {
    return [];
  }
  const results = searchIndex.search(query, { prefix: true, fuzzy: 0.2, fields: ['title'] });
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
