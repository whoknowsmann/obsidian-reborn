import type { TreeNode } from '../types';

type SidebarProps = {
  tree: TreeNode[];
  onOpenNote: (path: string) => void;
  onRenameEntry: (node: TreeNode) => void;
  onMoveEntry: (node: TreeNode) => void;
  onDeleteEntry: (node: TreeNode) => void;
  onCreateEntry: (type: 'file' | 'folder', parentPath?: string) => void;
};

const Sidebar = ({
  tree,
  onOpenNote,
  onRenameEntry,
  onMoveEntry,
  onDeleteEntry,
  onCreateEntry
}: SidebarProps) => {
  const renderTree = (nodes: TreeNode[], depth = 0) =>
    nodes.map((node) => (
      <div key={node.path} className="tree-node" style={{ paddingLeft: depth * 12 }}>
        <div className="tree-row">
          <button
            className={`tree-entry ${node.type}`}
            onClick={() => node.type === 'file' && onOpenNote(node.path)}
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
      <div className="tree">{renderTree(tree)}</div>
    </aside>
  );
};

export default Sidebar;
