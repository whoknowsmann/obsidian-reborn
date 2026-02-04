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
  tags: string[];
  lastModified: number;
  lowerTitle: string;
  lowerPath: string;
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
  theme?: 'dark' | 'light';
  editorFontSize?: number;
};

const defaultSettings: Settings = {
  theme: 'dark',
  editorFontSize: 14
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let mainWindow: BrowserWindow | null = null;
let vaultPath: string | null = null;
let watcher: chokidar.FSWatcher | null = null;

const normalizeTitle = (value: string) => value.trim().toLowerCase();
const noteTitleFromPath = (filePath: string) => path.basename(filePath, path.extname(filePath));
const isMarkdownFile = (filePath: string) => filePath.toLowerCase().endsWith('.md');
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

const wikiLinkRegex = /(!?)\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
const tagRegex = /(^|[^A-Za-z0-9/_-])#([A-Za-z0-9][A-Za-z0-9/_-]*)/g;

const stripCodeFences = (content: string) => {
  const lines = content.split(/\r?\n/);
  const filtered: string[] = [];
  let inCodeBlock = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!inCodeBlock) {
      filtered.push(line);
    }
  }
  return filtered;
};

const parseTags = (content: string) => {
  const tags = new Set<string>();
  const lines = stripCodeFences(content);
  for (const line of lines) {
    tagRegex.lastIndex = 0;
    let match = tagRegex.exec(line);
    while (match) {
      tags.add(match[2].toLowerCase());
      match = tagRegex.exec(line);
    }
  }
  return Array.from(tags).sort();
};

const normalizeTag = (tag: string) => tag.replace(/^#/, '').toLowerCase();

const parseTagQuery = (query: string) => {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const tagFilters: string[] = [];
  const textTokens: string[] = [];
  for (const token of tokens) {
    if (token.toLowerCase().startsWith('tag:')) {
      let value = token.slice(4);
      if (!value) {
        continue;
      }
      value = normalizeTag(value);
      if (value) {
        tagFilters.push(value);
      }
      continue;
    }
    textTokens.push(token);
  }
  return { tagFilters, textQuery: textTokens.join(' ') };
};

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
    return { ...defaultSettings };
  }
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Settings;
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
};

const saveSettings = async (settings: Settings) => {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
};

const updateSettings = async (partial: Settings) => {
  const current = await loadSettings();
  const next = { ...current, ...partial };
  await saveSettings(next);
  return next;
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

// Rename helper functions
const resolveTitle = (title: string, map: Map<string, string>) =>
  map.get(normalizeTitle(title)) ?? null;

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

class VaultIndex {
  private notes = new Map<string, NoteIndexEntry>();
  private titleToPath = new Map<string, string>();
  private backlinks = new Map<string, Set<string>>();
  private tagIndex = new Map<string, Set<string>>();
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

  getLocalGraph(filePath: string) {
    const entry = this.notes.get(filePath);
    if (!entry) {
      return { nodes: [], edges: [] };
    }
    const nodes = new Map<string, { path: string; title: string }>();
    const edges: { from: string; to: string }[] = [];
    const addNode = (pathValue: string) => {
      const note = this.notes.get(pathValue);
      nodes.set(pathValue, {
        path: pathValue,
        title: note?.title ?? noteTitleFromPath(pathValue)
      });
    };
    addNode(filePath);
    const outgoingTargets = new Set<string>();
    for (const link of entry.links) {
      const targetPath = this.titleToPath.get(link);
      if (!targetPath) {
        continue;
      }
      outgoingTargets.add(targetPath);
      addNode(targetPath);
      edges.push({ from: filePath, to: targetPath });
    }
    const incoming = this.backlinks.get(filePath);
    if (incoming) {
      for (const sourcePath of incoming) {
        addNode(sourcePath);
        edges.push({ from: sourcePath, to: filePath });
      }
    }
    return { nodes: Array.from(nodes.values()), edges };
  }

  // Get files that link to this path (for rename operations)
  getAffectedFilesForRename(sourcePath: string) {
    const links = this.backlinks.get(sourcePath);
    if (!links) {
      return [];
    }
    return Array.from(links).sort((a, b) => a.localeCompare(b));
  }

  // Get a snapshot of the title->path map for link resolution during rename
  getTitleToPathSnapshot() {
    return new Map(this.titleToPath);
  }

  search(query: string) {
    if (!query.trim()) {
      return [];
    }
    const { tagFilters, textQuery } = parseTagQuery(query);
    if (tagFilters.length === 0) {
      return this.searchIndex.search(query, { prefix: true, fuzzy: 0.2 }).slice(0, 50);
    }
    const matchingEntries = Array.from(this.notes.values()).filter((entry) =>
      tagFilters.every((tag) => entry.tags.includes(tag))
    );
    if (!textQuery.trim()) {
      return matchingEntries
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, 50)
        .map((entry) => ({
          id: entry.path,
          title: entry.title,
          path: entry.path,
          score: 1
        }));
    }
    const textResults = this.searchIndex.search(textQuery, { prefix: true, fuzzy: 0.2 });
    const tagMatchSet = new Set(matchingEntries.map((entry) => entry.path));
    return textResults.filter((result) => tagMatchSet.has(result.id)).slice(0, 50);
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
    this.tagIndex = new Map();
    this.searchIndex = new MiniSearch<NoteIndexEntry>({
      fields: ['title', 'content'],
      storeFields: ['title', 'path'],
      idField: 'path'
    });
    const files = await getAllMarkdownFiles(this.vaultPath);
    await Promise.all(files.map((file) => this.indexFile(file, false)));
    this.rebuildBacklinks();
    this.rebuildTagIndex();
    this.rebuildSearchIndex();
  }

  async updateFile(filePath: string) {
    await this.indexFile(filePath, true);
    this.rebuildBacklinks();
    this.rebuildTagIndex();
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
    this.rebuildTagIndex();
    this.rebuildSearchIndex();
  }

  // Rebuild indexes after batch updates (used during rename)
  rebuildDerivedIndexes() {
    this.rebuildBacklinks();
    this.rebuildTagIndex();
    this.rebuildSearchIndex();
  }

  // Index a file without rebuilding derived indexes (for batch operations)
  async indexFileOnly(filePath: string) {
    await this.indexFile(filePath, true);
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
    const tags = parseTags(content);
    const entry: NoteIndexEntry = {
      path: filePath,
      title,
      content,
      links,
      tags,
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

  private rebuildTagIndex() {
    this.tagIndex = new Map();
    for (const entry of this.notes.values()) {
      for (const tag of entry.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)?.add(entry.path);
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

  getTagSummary() {
    return Array.from(this.tagIndex.entries())
      .map(([tag, paths]) => ({ tag, count: paths.size }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  getNotesForTag(tag: string) {
    const normalized = normalizeTag(tag);
    const notes = this.tagIndex.get(normalized);
    if (!notes) {
      return [];
    }
    return Array.from(notes).sort((a, b) => {
      const aTitle = this.notes.get(a)?.title ?? noteTitleFromPath(a);
      const bTitle = this.notes.get(b)?.title ?? noteTitleFromPath(b);
      return aTitle.localeCompare(bTitle);
    });
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
  await updateSettings({ lastVault: vaultPath });
  await vaultIndex.build();
  startWatcher();
  return vaultPath;
});

ipcMain.handle('vault:set', async (_event, newVaultPath: string) => {
  vaultPath = newVaultPath;
  vaultIndex.setVaultPath(vaultPath);
  await updateSettings({ lastVault: vaultPath });
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
  await checkRenameConflict(sourcePath, targetPath);
  await renamePathSafe(sourcePath, targetPath);
  if (isMarkdownFile(sourcePath)) {
    vaultIndex.removeFile(sourcePath);
  }
  if (isMarkdownFile(targetPath)) {
    await vaultIndex.updateFile(targetPath);
  }
});

ipcMain.handle(
  'entry:prepareRename',
  async (_event, sourcePath: string, targetPath: string): Promise<RenamePreview> => {
    ensureVaultSet();
    const oldTitle = noteTitleFromPath(sourcePath);
    const newTitle = noteTitleFromPath(targetPath);
    const affectedFiles = isMarkdownFile(sourcePath) ? vaultIndex.getAffectedFilesForRename(sourcePath) : [];
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
      const titleMapSnapshot = vaultIndex.getTitleToPathSnapshot();
      const affectedFiles = vaultIndex.getAffectedFilesForRename(sourcePath);
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
      // Update index: remove old path and re-index affected files
      vaultIndex.removeFile(sourcePath);
      const pathsToIndex = new Set([targetPath, ...adjustedPaths]);
      for (const filePath of pathsToIndex) {
        if (isMarkdownFile(filePath)) {
          await vaultIndex.indexFileOnly(filePath);
        }
      }
      vaultIndex.rebuildDerivedIndexes();
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
    vaultIndex.removeFile(targetPath);
  }
});

ipcMain.handle('search:query', async (_event, query: string) => {
  return vaultIndex.search(query);
});

ipcMain.handle('note:quickSwitch', async (_event, query: string) => vaultIndex.searchNotes(query));

ipcMain.handle('tags:getSummary', async () => {
  return vaultIndex.getTagSummary();
});

ipcMain.handle('tags:getNotes', async (_event, tag: string) => {
  return vaultIndex.getNotesForTag(tag);
});

ipcMain.handle('note:openByTitle', async (_event, title: string) => {
  return vaultIndex.openByTitle(title);
});

ipcMain.handle('note:exists', async (_event, title: string) => {
  return vaultIndex.noteExists(title);
});

ipcMain.handle('backlinks:get', async (_event, filePath: string) => {
  return vaultIndex.getBacklinks(filePath);
});

ipcMain.handle('graph:local', async (_event, filePath: string) => {
  return vaultIndex.getLocalGraph(filePath);
});

ipcMain.handle('settings:get', async () => loadSettings());

ipcMain.handle('settings:update', async (_event, partial: Settings) => updateSettings(partial));

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
