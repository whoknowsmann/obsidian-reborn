import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
};

type OpenNote = {
  path: string;
  title: string;
  content: string;
  dirty: boolean;
};

type SearchResult = {
  id: string;
  title: string;
  path: string;
  displayPath?: string;
  score: number;
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

type ViewMode = 'split' | 'editor' | 'preview';
type PaletteMode = 'command' | 'open-note' | 'create-note';

type CommandItem = {
  id: string;
  label: string;
  description: string;
  onSelect: () => void;
};

type QuickSwitchResponse = {
  results: SearchResult[];
  hasExactMatch: boolean;
};

type PaletteListItem =
  | { type: 'command'; command: CommandItem }
  | { type: 'note'; note: SearchResult }
  | { type: 'create'; title: string };

const normalizeTitle = (value: string) => value.trim().toLowerCase();
const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

const convertWikiLinks = (content: string) =>
  content.replace(wikiRegex, (_match, target, alias) => {
    const label = alias ?? target;
    return `[${label}](wikilink:${encodeURIComponent(target)})`;
  });

const collectNodes = (nodes: TreeNode[] = [], items: TreeNode[] = []) => {
  for (const node of nodes) {
    items.push(node);
    if (node.children) {
      collectNodes(node.children, items);
    }
  }
  return items;
};

const findNodeByPath = (nodes: TreeNode[], path: string): TreeNode | undefined =>
  collectNodes(nodes).find((node) => node.path === path);

const noteTitleFromPath = (filePath: string) => {
  const parts = filePath.split(/[/\\]/);
  const fileName = parts[parts.length - 1];
  return fileName.replace(/\.md$/i, '');
};

const getParentFolder = (filePath: string) => filePath.split(/[/\\]/).slice(0, -1).join('/');

const isAbsolutePath = (value: string) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);

const formatDailyTitle = (date = new Date()) => date.toISOString().slice(0, 10);

const fuzzyScore = (query: string, target: string) => {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) {
    return 1;
  }
  const normalizedTarget = target.toLowerCase();
  let score = 0;
  let lastMatch = -1;
  for (const char of normalizedQuery) {
    const index = normalizedTarget.indexOf(char, lastMatch + 1);
    if (index === -1) {
      return 0;
    }
    score += index === lastMatch + 1 ? 2 : 1;
    lastMatch = index;
  }
  return score / normalizedTarget.length;
};

const CommandPalette = memo(
  ({
    open,
    onClose,
    onOpenNote,
    onCreateNote,
    onTogglePreview,
    onToggleSplit,
    onOpenDaily
  }: {
    open: boolean;
    onClose: () => void;
    onOpenNote: (path: string, options?: { openInNewTab?: boolean }) => void;
    onCreateNote: (title: string) => Promise<void>;
    onTogglePreview: () => void;
    onToggleSplit: () => void;
    onOpenDaily: () => Promise<void>;
  }) => {
    const [mode, setMode] = useState<PaletteMode>('open-note');
    const [query, setQuery] = useState('');
    const [noteResults, setNoteResults] = useState<SearchResult[]>([]);
    const [hasExactMatch, setHasExactMatch] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const resetPalette = useCallback(() => {
      setMode('open-note');
      setQuery('');
      setNoteResults([]);
      setHasExactMatch(false);
      setActiveIndex(0);
    }, []);

    const switchMode = useCallback((nextMode: PaletteMode) => {
      setMode(nextMode);
      setQuery('');
      setNoteResults([]);
      setHasExactMatch(false);
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }, []);

    useEffect(() => {
      if (open) {
        resetPalette();
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    }, [open, resetPalette]);

    useEffect(() => {
      if (!open || mode === 'create-note') {
        return;
      }
      const trimmed = query.trimStart();
      const wantsCommands = trimmed.startsWith('>');
      if (wantsCommands && mode !== 'command') {
        setMode('command');
      }
      if (!wantsCommands && mode === 'command') {
        setMode('open-note');
      }
    }, [open, mode, query]);

    const commandQuery = useMemo(() => query.replace(/^>\s*/, ''), [query]);

    useEffect(() => {
      if (!open || mode !== 'open-note') {
        return;
      }
      if (!query.trim()) {
        setNoteResults([]);
        setHasExactMatch(false);
        return;
      }
      const timeout = window.setTimeout(async () => {
        const response = (await window.vaultApi.quickSwitch(query)) as QuickSwitchResponse;
        setNoteResults(response.results);
        setHasExactMatch(response.hasExactMatch);
        setActiveIndex(0);
      }, 60);
      return () => window.clearTimeout(timeout);
    }, [open, mode, query]);

    const commandItems = useMemo<CommandItem[]>(() => {
      const items: CommandItem[] = [
        {
          id: 'open-note',
          label: 'Open Note',
          description: 'Quick switcher for notes',
          onSelect: () => switchMode('open-note')
        },
        {
          id: 'create-note',
          label: 'Create Note',
          description: 'Create a new note in the vault',
          onSelect: () => switchMode('create-note')
        },
        {
          id: 'toggle-preview',
          label: 'Toggle Preview',
          description: 'Switch between preview and split',
          onSelect: () => {
            onTogglePreview();
            onClose();
          }
        },
        {
          id: 'toggle-split',
          label: 'Toggle Split View',
          description: 'Switch between split and editor',
          onSelect: () => {
            onToggleSplit();
            onClose();
          }
        },
        {
          id: 'daily-note',
          label: 'Open Daily Note',
          description: 'Open today’s daily note',
          onSelect: async () => {
            await onOpenDaily();
            onClose();
          }
        }
      ];
      if (!commandQuery.trim()) {
        return items;
      }
      return items
        .map((item) => ({
          item,
          score: fuzzyScore(commandQuery, `${item.label} ${item.description}`)
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ item }) => item);
    }, [commandQuery, onClose, onOpenDaily, onTogglePreview, onToggleSplit, switchMode]);

    const noteItems = useMemo<PaletteListItem[]>(() => {
      if (mode !== 'open-note') {
        return [];
      }
      const trimmed = query.trim();
      const items: PaletteListItem[] = noteResults.map((note) => ({ type: 'note', note }));
      if (trimmed && !hasExactMatch) {
        items.unshift({ type: 'create', title: trimmed });
      }
      return items;
    }, [mode, noteResults, query, hasExactMatch]);

    const commandListItems = useMemo<PaletteListItem[]>(
      () => commandItems.map((command) => ({ type: 'command', command })),
      [commandItems]
    );

    const activeItems = mode === 'command' ? commandListItems : mode === 'open-note' ? noteItems : [];
    const activeCount = activeItems.length;

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % Math.max(activeCount, 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + Math.max(activeCount, 1)) % Math.max(activeCount, 1));
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (mode !== 'open-note') {
          switchMode('open-note');
          return;
        }
        onClose();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const isNewTab = event.metaKey || event.ctrlKey;
        if (mode === 'command') {
          const target = commandItems[activeIndex];
          target?.onSelect();
          return;
        }
        if (mode === 'open-note') {
          const target = activeItems[activeIndex];
          if (!target) {
            return;
          }
          if (target.type === 'note') {
            onOpenNote(target.note.path, { openInNewTab: isNewTab });
            onClose();
            return;
          }
          if (target.type === 'create') {
            void onCreateNote(target.title).then(onClose);
          }
          return;
        }
        if (mode === 'create-note' && query.trim()) {
          void onCreateNote(query.trim()).then(onClose);
        }
      }
    };

    if (!open) {
      return null;
    }

    return (
      <div className="palette-overlay" onClick={onClose}>
        <div className="palette" onClick={(event) => event.stopPropagation()}>
          <div className="palette-header">
            <span className="palette-mode">
              {mode === 'command' && 'Commands'}
              {mode === 'open-note' && 'Quick Switcher'}
              {mode === 'create-note' && 'Create Note'}
            </span>
            <span className="palette-hint">Esc to close · ↑/↓ to navigate</span>
          </div>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={
              mode === 'command'
                ? 'Type a command...'
                : mode === 'open-note'
                ? 'Search notes or type > for commands...'
                : 'New note title...'
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="palette-list">
            {mode === 'command' &&
              commandListItems.map((item, index) => (
                <button
                  key={item.command.id}
                  className={`palette-item ${index === activeIndex ? 'active' : ''}`}
                  onClick={item.command.onSelect}
                >
                  <div className="palette-item-title">{item.command.label}</div>
                  <div className="palette-item-desc">{item.command.description}</div>
                </button>
              ))}
            {mode === 'open-note' &&
              noteItems.map((item, index) => (
                <button
                  key={item.type === 'note' ? item.note.id : `create-${item.title}`}
                  className={`palette-item ${index === activeIndex ? 'active' : ''}`}
                  onClick={() => {
                    if (item.type === 'note') {
                      onOpenNote(item.note.path);
                      onClose();
                      return;
                    }
                    if (item.type === 'create') {
                      void onCreateNote(item.title).then(onClose);
                    }
                  }}
                >
                  <div className="palette-item-title">
                    {item.type === 'note' ? item.note.title : `Create “${item.title}”`}
                  </div>
                  <div className="palette-item-desc">
                    {item.type === 'note'
                      ? item.note.displayPath ?? item.note.path
                      : 'Create a new note with this title'}
                  </div>
                </button>
              ))}
            {mode === 'create-note' && (
              <div className="palette-empty">
                Press Enter to create <strong>{query.trim() || 'a new note'}</strong>.
              </div>
            )}
            {mode !== 'create-note' && activeCount === 0 && (
              <div className="palette-empty">No results.</div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

const App = () => {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [openNotes, setOpenNotes] = useState<OpenNote[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [lastUsedFolder, setLastUsedFolder] = useState<string | null>(null);
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [renamePlan, setRenamePlan] = useState<RenamePreview | null>(null);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameApplying, setRenameApplying] = useState(false);
  const [renameApplyWithoutPreview, setRenameApplyWithoutPreview] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameFailureDetails, setRenameFailureDetails] = useState<{
    updatedFiles: string[];
    failedFiles: string[];
  } | null>(null);
  const saveTimeouts = useRef<Map<string, number>>(new Map());

  const activeNote = openNotes.find((note) => note.path === activePath) ?? null;
  const activeNode = useMemo(
    () => (activePath ? findNodeByPath(tree, activePath) : undefined),
    [activePath, tree]
  );

  const loadTree = useCallback(async () => {
    if (!vaultPath) {
      return;
    }
    const result = await window.vaultApi.getTree();
    setTree(result);
  }, [vaultPath]);

  const loadBacklinks = useCallback(async () => {
    if (!activePath) {
      setBacklinks([]);
      return;
    }
    const links = await window.vaultApi.getBacklinks(activePath);
    setBacklinks(links);
  }, [activePath]);

  const openNoteByPath = useCallback(
    async (filePath: string, options?: { openInNewTab?: boolean }) => {
      const openInNewTab = options?.openInNewTab ?? false;
      const existing = openNotes.find((note) => note.path === filePath);
      if (existing) {
        if (!openInNewTab) {
          setActivePath(filePath);
        }
        return;
      }
      const content = await window.vaultApi.readFile(filePath);
      const title = noteTitleFromPath(filePath);
      const newNote: OpenNote = { path: filePath, title, content, dirty: false };
      setOpenNotes((prev) => [...prev, newNote]);
      if (!openInNewTab || !activePath) {
        setActivePath(filePath);
      }
      setLastUsedFolder(getParentFolder(filePath));
    },
    [openNotes, activePath]
  );

  const openNoteByTitle = useCallback(
    async (title: string) => {
      const targetPath = await window.vaultApi.openByTitle(normalizeTitle(title));
      if (targetPath) {
        await openNoteByPath(targetPath);
        return;
      }
      const shouldCreate = window.confirm(`Create note "${title}"?`);
      if (!shouldCreate || !vaultPath) {
        return;
      }
      const filePath = `${vaultPath}/${title}.md`;
      await window.vaultApi.createFile(filePath, `# ${title}\n`);
      await loadTree();
      await openNoteByPath(filePath);
    },
    [openNoteByPath, vaultPath, loadTree]
  );

  const createNoteWithTitle = useCallback(
    async (title: string, options?: { basePath?: string }) => {
      if (!vaultPath) {
        return;
      }
      const existing = await window.vaultApi.openByTitle(normalizeTitle(title));
      if (existing) {
        await openNoteByPath(existing);
        return;
      }
      const basePath = options?.basePath ?? lastUsedFolder ?? vaultPath;
      const filePath = `${basePath}/${title}.md`;
      await window.vaultApi.createFile(filePath, `# ${title}\n`);
      await loadTree();
      await openNoteByPath(filePath);
      setLastUsedFolder(basePath);
    },
    [vaultPath, lastUsedFolder, loadTree, openNoteByPath]
  );

  const openDailyNote = useCallback(async () => {
    const title = formatDailyTitle();
    if (!vaultPath) {
      return;
    }
    const hasDailyFolder = await window.vaultApi.hasDailyFolder();
    const basePath = hasDailyFolder ? `${vaultPath}/Daily` : vaultPath;
    await createNoteWithTitle(title, { basePath });
  }, [createNoteWithTitle, vaultPath]);

  const scheduleSave = useCallback((notePath: string, content: string) => {
    const existing = saveTimeouts.current.get(notePath);
    if (existing) {
      window.clearTimeout(existing);
    }
    const timeout = window.setTimeout(async () => {
      await window.vaultApi.writeFile(notePath, content);
      setOpenNotes((prev) =>
        prev.map((note) => (note.path === notePath ? { ...note, dirty: false } : note))
      );
    }, 500);
    saveTimeouts.current.set(notePath, timeout);
  }, []);

  const updateContent = (notePath: string, content: string) => {
    setOpenNotes((prev) =>
      prev.map((note) => (note.path === notePath ? { ...note, content, dirty: true } : note))
    );
    scheduleSave(notePath, content);
  };

  const closeTab = (notePath: string) => {
    setOpenNotes((prev) => prev.filter((note) => note.path !== notePath));
    if (activePath === notePath) {
      const remaining = openNotes.filter((note) => note.path !== notePath);
      setActivePath(remaining[0]?.path ?? null);
    }
  };

  const handleVaultSelect = async () => {
    const result = await window.vaultApi.selectVault();
    if (result) {
      setVaultPath(result);
    }
  };

  const createNewEntry = async (type: 'file' | 'folder', parentPath?: string) => {
    if (!vaultPath) {
      return;
    }
    const name = window.prompt(`New ${type} name`);
    if (!name) {
      return;
    }
    const basePath = parentPath ?? vaultPath;
    const targetPath = type === 'file' ? `${basePath}/${name}.md` : `${basePath}/${name}`;
    if (type === 'file') {
      await window.vaultApi.createFile(targetPath, `# ${name}\n`);
      await openNoteByPath(targetPath);
      setLastUsedFolder(getParentFolder(targetPath));
    } else {
      await window.vaultApi.createFolder(targetPath);
    }
    await loadTree();
  };

  const startRenameFlow = async (sourcePath: string, targetPath: string) => {
    try {
      setRenameError(null);
      setRenameFailureDetails(null);
      const plan = (await window.vaultApi.prepareRenameEntry(sourcePath, targetPath)) as RenamePreview;
      setRenamePlan(plan);
      setRenameModalOpen(true);
      setRenameApplying(false);
      setRenameApplyWithoutPreview(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to prepare rename.';
      window.alert(message);
    }
  };

  const closeRenameModal = () => {
    if (renameApplying) {
      return;
    }
    setRenameModalOpen(false);
    setRenamePlan(null);
    setRenameError(null);
    setRenameFailureDetails(null);
  };

  const renameEntry = async (node: TreeNode) => {
    const newName = window.prompt('Rename to', node.name.replace(/\.md$/i, ''));
    if (!newName || !vaultPath) {
      return;
    }
    const parent = node.path.split(/[/\\]/).slice(0, -1).join('/');
    const targetPath = node.type === 'file' ? `${parent}/${newName}.md` : `${parent}/${newName}`;
    if (targetPath === node.path) {
      return;
    }
    await startRenameFlow(node.path, targetPath);
  };

  const moveEntry = async (node: TreeNode) => {
    if (!vaultPath) {
      return;
    }
    const currentFolder = getParentFolder(node.path);
    const currentRelative = currentFolder.replace(`${vaultPath}/`, '');
    const destination = window.prompt('Move to folder (relative to vault)', currentRelative || '.');
    if (destination === null) {
      return;
    }
    const trimmed = destination.trim();
    const targetFolder = trimmed === '' || trimmed === '.'
      ? vaultPath
      : isAbsolutePath(trimmed)
      ? trimmed
      : `${vaultPath}/${trimmed}`;
    const targetPath = `${targetFolder}/${node.name}`;
    if (targetPath === node.path) {
      return;
    }
    await startRenameFlow(node.path, targetPath);
  };

  const deleteEntry = async (node: TreeNode) => {
    const confirmed = window.confirm(`Delete ${node.name}?`);
    if (!confirmed) {
      return;
    }
    await window.vaultApi.deleteEntry(node.path);
    if (node.type === 'file') {
      closeTab(node.path);
    }
    await loadTree();
  };

  const applyRename = async () => {
    if (!renamePlan) {
      return;
    }
    setRenameApplying(true);
    setRenameError(null);
    setRenameFailureDetails(null);
    const result = (await window.vaultApi.applyRenameEntry(
      renamePlan.sourcePath,
      renamePlan.targetPath
    )) as RenameApplyResult;
    if (!result.ok) {
      setRenameError(result.error ?? 'Rename failed.');
      setRenameFailureDetails({
        updatedFiles: result.updatedFiles,
        failedFiles: result.failedFiles
      });
      setRenameApplying(false);
      return;
    }
    const renamedNotes = openNotes.map((note) =>
      note.path === renamePlan.sourcePath
        ? {
            ...note,
            path: renamePlan.targetPath,
            title: noteTitleFromPath(renamePlan.targetPath)
          }
        : note
    );
    setOpenNotes(renamedNotes);
    setActivePath((prev) => (prev === renamePlan.sourcePath ? renamePlan.targetPath : prev));
    if (result.updatedFiles.length > 0) {
      const pathSet = new Set(result.updatedFiles);
      const refreshed = await Promise.all(
        renamedNotes.map(async (note) => {
          if (!pathSet.has(note.path) || note.dirty) {
            return note;
          }
          const content = await window.vaultApi.readFile(note.path);
          return { ...note, content, dirty: false };
        })
      );
      setOpenNotes(refreshed);
    }
    setRenameModalOpen(false);
    setRenamePlan(null);
    setRenameError(null);
    setRenameFailureDetails(null);
    setRenameApplying(false);
    await loadTree();
  };

  useEffect(() => {
    window.vaultApi.getLastVault().then((last) => {
      if (last) {
        window.vaultApi.setVault(last).then((path) => setVaultPath(path));
      }
    });
  }, []);

  useEffect(() => {
    if (!vaultPath) {
      return;
    }
    loadTree();
    const unsubscribe = window.vaultApi.onVaultChanged(() => loadTree());
    return () => unsubscribe();
  }, [vaultPath, loadTree]);

  useEffect(() => {
    loadBacklinks();
  }, [activePath, loadBacklinks]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timeout = window.setTimeout(async () => {
      const results = await window.vaultApi.search(searchQuery);
      setSearchResults(results as SearchResult[]);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'p') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const togglePreview = useCallback(() => {
    setViewMode((prev) => (prev === 'preview' ? 'split' : 'preview'));
  }, []);

  const toggleSplit = useCallback(() => {
    setViewMode((prev) => (prev === 'split' ? 'editor' : 'split'));
  }, []);

  const markdownContent = useMemo(() => {
    if (!activeNote) {
      return '';
    }
    return convertWikiLinks(activeNote.content);
  }, [activeNote]);

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path} className="tree-node" style={{ paddingLeft: depth * 12 }}>
        <div className="tree-row">
          <button
            className={`tree-entry ${node.type}`}
            onClick={() => node.type === 'file' && openNoteByPath(node.path)}
          >
            {node.name}
          </button>
          <div className="tree-actions">
            <button onClick={() => renameEntry(node)} title="Rename">
              ✏️
            </button>
            <button onClick={() => moveEntry(node)} title="Move">
              📂
            </button>
            <button onClick={() => deleteEntry(node)} title="Delete">
              🗑️
            </button>
            {node.type === 'folder' && (
              <button onClick={() => createNewEntry('file', node.path)} title="New file">
                ➕
              </button>
            )}
          </div>
        </div>
        {node.children && renderTree(node.children, depth + 1)}
      </div>
    ));
  };

  const handleLinkClick = async (href?: string, event?: MouseEvent) => {
    if (!href?.startsWith('wikilink:')) {
      return;
    }
    event?.preventDefault();
    const target = decodeURIComponent(href.replace('wikilink:', ''));
    if (event?.metaKey || event?.ctrlKey) {
      await openNoteByTitle(target);
      return;
    }
    await openNoteByTitle(target);
  };

  return (
    <div className="app">
      <header className="top-bar">
        <div className="vault-controls">
          <button onClick={handleVaultSelect}>Open Vault</button>
          <span>{vaultPath ?? 'No vault selected'}</span>
        </div>
        <div className="search">
          <input
            placeholder="Search vault..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  className="search-result"
                  onClick={() => openNoteByPath(result.path)}
                >
                  <strong>{result.title}</strong>
                  <span>{result.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="view-toggle">
          <button onClick={() => setViewMode('editor')} className={viewMode === 'editor' ? 'active' : ''}>
            Editor
          </button>
          <button onClick={() => setViewMode('split')} className={viewMode === 'split' ? 'active' : ''}>
            Split
          </button>
          <button onClick={() => setViewMode('preview')} className={viewMode === 'preview' ? 'active' : ''}>
            Preview
          </button>
        </div>
      </header>
      <div className="content">
        <aside className="sidebar left">
          <div className="sidebar-header">
            <h3>Files</h3>
            <div className="sidebar-actions">
              <button onClick={() => createNewEntry('file')}>New Note</button>
              <button onClick={() => createNewEntry('folder')}>New Folder</button>
            </div>
          </div>
          <div className="tree">{renderTree(tree)}</div>
        </aside>
        <main className="main">
          <div className="tabs">
            {openNotes.map((note) => (
              <button
                key={note.path}
                className={`tab ${note.path === activePath ? 'active' : ''}`}
                onClick={() => setActivePath(note.path)}
              >
                {note.title}{note.dirty ? ' *' : ''}
                <span className="tab-close" onClick={(event) => {
                  event.stopPropagation();
                  closeTab(note.path);
                }}>
                  ✕
                </span>
              </button>
            ))}
          </div>
          {!activeNote && <div className="empty">Open a note to start editing.</div>}
          {activeNote && (
            <>
              <div className="note-actions">
                <div className="note-actions-title">{activeNote.title}</div>
                <div className="note-actions-buttons">
                  <button onClick={() => activeNode && renameEntry(activeNode)}>Rename</button>
                  <button onClick={() => activeNode && moveEntry(activeNode)}>Move</button>
                </div>
              </div>
              <div className={`editor-preview ${viewMode}`}>
                {(viewMode === 'split' || viewMode === 'editor') && (
                  <textarea
                    value={activeNote.content}
                    onChange={(event) => updateContent(activeNote.path, event.target.value)}
                  />
                )}
                {(viewMode === 'split' || viewMode === 'preview') && (
                  <div className="preview">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children, ...props }) => (
                          <a
                            {...props}
                            href={href}
                            onClick={(event) => handleLinkClick(href, event)}
                          >
                            {children}
                          </a>
                        ),
                        blockquote: ({ children }) => {
                          const text = children?.[0]?.toString?.() ?? '';
                          const match = /\[!([A-Z]+)\]/.exec(text);
                          if (match) {
                            return (
                              <div className={`callout callout-${match[1].toLowerCase()}`}>
                                {children}
                              </div>
                            );
                          }
                          return <blockquote>{children}</blockquote>;
                        }
                      }}
                    >
                      {markdownContent}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
        <aside className="sidebar right">
          <div className="sidebar-header">
            <h3>Backlinks</h3>
          </div>
          <div className="backlinks">
            {backlinks.length === 0 && <p>No backlinks yet.</p>}
            {backlinks.map((link) => {
              const node = findNodeByPath(tree, link);
              return (
                <button key={link} onClick={() => openNoteByPath(link)}>
                  {node?.name ?? link}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
      {renameModalOpen && renamePlan && (
        <div className="modal-overlay" onClick={closeRenameModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">Rename note: {renamePlan.oldTitle} → {renamePlan.newTitle}</div>
            <div className="modal-subtitle">Files to update: {renamePlan.affectedFiles.length}</div>
            {renamePlan.affectedFiles.length > 25 && (
              <label className="modal-toggle">
                <input
                  type="checkbox"
                  checked={renameApplyWithoutPreview}
                  onChange={(event) => setRenameApplyWithoutPreview(event.target.checked)}
                />
                Apply without preview
              </label>
            )}
            {!renameApplyWithoutPreview && renamePlan.affectedFiles.length > 0 && (
              <ul className="modal-list">
                {renamePlan.affectedFiles.map((filePath) => (
                  <li key={filePath}>{filePath}</li>
                ))}
              </ul>
            )}
            {renameError && (
              <div className="modal-error">
                <strong>{renameError}</strong>
                {renameFailureDetails && (
                  <div className="modal-error-details">
                    <div>Updated: {renameFailureDetails.updatedFiles.length}</div>
                    <div>Not updated: {renameFailureDetails.failedFiles.length}</div>
                    {renameFailureDetails.updatedFiles.length > 0 && (
                      <ul>
                        {renameFailureDetails.updatedFiles.map((filePath) => (
                          <li key={filePath}>{filePath}</li>
                        ))}
                      </ul>
                    )}
                    {renameFailureDetails.failedFiles.length > 0 && (
                      <ul>
                        {renameFailureDetails.failedFiles.map((filePath) => (
                          <li key={filePath}>{filePath}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button onClick={closeRenameModal} disabled={renameApplying}>
                Cancel
              </button>
              <button onClick={applyRename} disabled={renameApplying}>
                {renameApplying ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenNote={openNoteByPath}
        onCreateNote={createNoteWithTitle}
        onTogglePreview={togglePreview}
        onToggleSplit={toggleSplit}
        onOpenDaily={openDailyNote}
      />
    </div>
  );
};

export default App;
