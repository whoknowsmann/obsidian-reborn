import type { TreeNode } from '../types';
import { findNodeByPath } from '../utils/tree';

type RightSidebarProps = {
  backlinks: string[];
  tree: TreeNode[];
  onOpenNote: (path: string) => void;
};

const RightSidebar = ({ backlinks, tree, onOpenNote }: RightSidebarProps) => (
  <aside className="sidebar right">
    <div className="sidebar-header">
      <h3>Backlinks</h3>
    </div>
    <div className="backlinks">
      {backlinks.length === 0 && <p>No backlinks yet.</p>}
      {backlinks.map((link) => {
        const node = findNodeByPath(tree, link);
        return (
          <button key={link} onClick={() => onOpenNote(link)}>
            {node?.name ?? link}
          </button>
        );
      })}
    </div>
  </aside>
);

export default RightSidebar;
