import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
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
  score: number;
};

type ViewMode = 'split' | 'editor' | 'preview';

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

const App = () => {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [openNotes, setOpenNotes] = useState<OpenNote[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const saveTimeouts = useRef<Map<string, number>>(new Map());

  const activeNote = openNotes.find((note) => note.path === activePath) ?? null;

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
    async (filePath: string) => {
      const existing = openNotes.find((note) => note.path === filePath);
      if (existing) {
        setActivePath(filePath);
        return;
      }
      const content = await window.vaultApi.readFile(filePath);
      const title = noteTitleFromPath(filePath);
      const newNote: OpenNote = { path: filePath, title, content, dirty: false };
      setOpenNotes((prev) => [...prev, newNote]);
      setActivePath(filePath);
    },
    [openNotes]
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
    } else {
      await window.vaultApi.createFolder(targetPath);
    }
    await loadTree();
  };

  const renameEntry = async (node: TreeNode) => {
    const newName = window.prompt('Rename to', node.name.replace(/\.md$/i, ''));
    if (!newName || !vaultPath) {
      return;
    }
    const parent = node.path.split(/[/\\]/).slice(0, -1).join('/');
    const targetPath = node.type === 'file' ? `${parent}/${newName}.md` : `${parent}/${newName}`;
    await window.vaultApi.renameEntry(node.path, targetPath);
    await loadTree();
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
    </div>
  );
};

export default App;
