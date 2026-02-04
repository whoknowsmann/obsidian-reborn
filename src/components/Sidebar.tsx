import type { TreeNode } from '../types';

type SidebarProps = {
  tree: TreeNode[];
  starredNotes: { path: string; title: string }[];
  onOpenNote: (path: string) => void;
  onRenameEntry: (node: TreeNode) => void;
  onMoveEntry: (node: TreeNode) => void;
  onDeleteEntry: (node: TreeNode) => void;
  onCreateEntry: (type: 'file' | 'folder', parentPath?: string) => void;
  onSelectFolder: (path: string | null) => void;
  selectedFolderPath: string | null;
};

const Sidebar = ({
  tree,
  starredNotes,
  onOpenNote,
  onRenameEntry,
  onMoveEntry,
  onDeleteEntry,
  onCreateEntry,
  onSelectFolder,
  selectedFolderPath
}: SidebarProps) => {
  const renderTree = (nodes: TreeNode[], depth = 0) =>
    nodes.map((node) => (
      <div key={node.path} className="tree-node" style={{ paddingLeft: depth * 12 }}>
        <div className="tree-row">
          <button
            className={`tree-entry ${node.type} ${selectedFolderPath === node.path ? 'selected' : ''}`}
            onClick={() => {
              if (node.type === 'file') {
                onOpenNote(node.path);
              } else {
                onSelectFolder(node.path);
              }
            }}
          >
            {node.name}
          </button>
          <div className="tree-actions">
            <button onClick={() => onRenameEntry(node)} title="Rename">
              ✏️
            </button>
            <button onClick={() => onMoveEntry(node)} title="Move">
              📂
            </button>
            <button onClick={() => onDeleteEntry(node)} title="Delete">
              🗑️
            </button>
            {node.type === 'folder' && (
              <button onClick={() => onCreateEntry('file', node.path)} title="New file">
                ➕
              </button>
            )}
          </div>
        </div>
        {node.children && renderTree(node.children, depth + 1)}
      </div>
    ));

  return (
    <aside className="sidebar left">
      <div className="sidebar-header">
        <h3>Files</h3>
        <div className="sidebar-actions">
          <button onClick={() => onCreateEntry('file')}>New Note</button>
          <button onClick={() => onCreateEntry('folder')}>New Folder</button>
        </div>
      </div>
      {starredNotes.length > 0 && (
        <div className="sidebar-section starred-section">
          <div className="sidebar-section-title">Starred</div>
          <div className="starred-list">
            {starredNotes.map((note) => (
              <button key={note.path} className="starred-item" onClick={() => onOpenNote(note.path)}>
                <span className="starred-icon">★</span>
                <span className="starred-title">{note.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="tree">{renderTree(tree)}</div>
    </aside>
  );
};

export default Sidebar;
