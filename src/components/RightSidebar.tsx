import type { OutlineHeading, TagSummary, TreeNode } from '../types';
import { findNodeByPath } from '../utils/tree';

type RightSidebarProps = {
  backlinks: string[];
  tree: TreeNode[];
  onOpenNote: (path: string) => void;
  outline: OutlineHeading[];
  onSelectHeading: (heading: OutlineHeading) => void;
  tags: TagSummary[];
  selectedTag: string | null;
  tagNotes: string[];
  onSelectTag: (tag: string) => void;
  onClearTag: () => void;
};

const RightSidebar = ({
  backlinks,
  tree,
  onOpenNote,
  outline,
  onSelectHeading,
  tags,
  selectedTag,
  tagNotes,
  onSelectTag,
  onClearTag
}: RightSidebarProps) => (
  <aside className="sidebar right">
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <h3>Outline</h3>
      </div>
      <div className="outline-list">
        {outline.length === 0 && <p className="muted">No headings yet.</p>}
        {outline.map((heading) => (
          <button
            key={`${heading.slug}-${heading.line}`}
            className="outline-item"
            style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
            onClick={() => onSelectHeading(heading)}
          >
            {heading.text}
          </button>
        ))}
      </div>
    </div>
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <h3>Tags</h3>
        {selectedTag && (
          <button className="link-button" onClick={onClearTag}>
            Clear
          </button>
        )}
      </div>
      <div className="tag-list">
        {tags.length === 0 && <p className="muted">No tags yet.</p>}
        {tags.map((tag) => (
          <button
            key={tag.tag}
            className={`tag-item ${selectedTag === tag.tag ? 'active' : ''}`}
            onClick={() => onSelectTag(tag.tag)}
          >
            <span className="tag-name">#{tag.tag}</span>
            <span className="tag-count">{tag.count}</span>
          </button>
        ))}
      </div>
      {selectedTag && (
        <div className="tag-results">
          <div className="tag-results-title">Notes tagged #{selectedTag}</div>
          {tagNotes.length === 0 && <p className="muted">No notes for this tag.</p>}
          {tagNotes.map((notePath) => {
            const node = findNodeByPath(tree, notePath);
            return (
              <button key={notePath} onClick={() => onOpenNote(notePath)}>
                {node?.name ?? notePath}
              </button>
            );
          })}
        </div>
      )}
    </div>
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <h3>Backlinks</h3>
      </div>
      <div className="backlinks">
        {backlinks.length === 0 && <p className="muted">No backlinks yet.</p>}
        {backlinks.map((link) => {
          const node = findNodeByPath(tree, link);
          return (
            <button key={link} onClick={() => onOpenNote(link)}>
              {node?.name ?? link}
            </button>
          );
        })}
      </div>
    </div>
  </aside>
);

export default RightSidebar;
