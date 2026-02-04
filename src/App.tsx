import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent
} from 'react';
import CommandPalette from './components/CommandPalette';
import EditorPanel from './components/EditorPanel';
import RenameModal, { type RenameFailureDetails } from './components/RenameModal';
import RightSidebar from './components/RightSidebar';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import TopBar from './components/TopBar';
import type {
  OpenNote,
  RenameApplyResult,
  RenamePreview,
  SearchResult,
  TreeNode,
  ViewMode
} from './types';
import {
  formatDailyTitle,
  getParentFolder,
  isAbsolutePath,
  normalizeTitle,
  noteTitleFromPath
} from './utils/notes';
import { findNodeByPath } from './utils/tree';

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
  const [renameFailureDetails, setRenameFailureDetails] = useState<RenameFailureDetails | null>(null);
  const saveTimeouts = useRef<Map<string, number>>(new Map());

  const activeNote = openNotes.find((note) => note.path === activePath) ?? null;
  const activeNode = useMemo(
    () => (activePath ? findNodeByPath(tree, activePath) ?? null : null),
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
    const targetFolder =
      trimmed === '' || trimmed === '.'
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
      <TopBar
        vaultPath={vaultPath}
        onSelectVault={handleVaultSelect}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        onOpenNote={openNoteByPath}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      <div className="content">
        <Sidebar
          tree={tree}
          onOpenNote={openNoteByPath}
          onRenameEntry={renameEntry}
          onMoveEntry={moveEntry}
          onDeleteEntry={deleteEntry}
          onCreateEntry={createNewEntry}
        />
        <main className="main">
          <TabBar
            openNotes={openNotes}
            activePath={activePath}
            onSelectTab={setActivePath}
            onCloseTab={closeTab}
          />
          <EditorPanel
            activeNote={activeNote}
            activeNode={activeNode}
            viewMode={viewMode}
            onUpdateContent={updateContent}
            onRename={renameEntry}
            onMove={moveEntry}
            onLinkClick={handleLinkClick}
          />
        </main>
        <RightSidebar backlinks={backlinks} tree={tree} onOpenNote={openNoteByPath} />
      </div>
      <RenameModal
        renamePlan={renamePlan}
        renameModalOpen={renameModalOpen}
        renameApplyWithoutPreview={renameApplyWithoutPreview}
        renameApplying={renameApplying}
        renameError={renameError}
        renameFailureDetails={renameFailureDetails}
        onClose={closeRenameModal}
        onApply={applyRename}
        onToggleApplyWithoutPreview={setRenameApplyWithoutPreview}
      />
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
