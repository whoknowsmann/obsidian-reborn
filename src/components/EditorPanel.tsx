import { useMemo, type MouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { OpenNote, TreeNode, ViewMode } from '../types';
import { convertWikiLinks } from '../utils/notes';

type EditorPanelProps = {
  activeNote: OpenNote | null;
  activeNode: TreeNode | null;
  viewMode: ViewMode;
  onUpdateContent: (path: string, content: string) => void;
  onRename: (node: TreeNode) => void;
  onMove: (node: TreeNode) => void;
  onLinkClick: (href?: string, event?: MouseEvent) => void;
};

type ViewModeToggleProps = {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
};

export const ViewModeToggle = ({ viewMode, onChange }: ViewModeToggleProps) => (
  <div className="view-toggle">
    <button onClick={() => onChange('editor')} className={viewMode === 'editor' ? 'active' : ''}>
      Editor
    </button>
    <button onClick={() => onChange('split')} className={viewMode === 'split' ? 'active' : ''}>
      Split
    </button>
    <button onClick={() => onChange('preview')} className={viewMode === 'preview' ? 'active' : ''}>
      Preview
    </button>
  </div>
);

const EditorPanel = ({
  activeNote,
  activeNode,
  viewMode,
  onUpdateContent,
  onRename,
  onMove,
  onLinkClick
}: EditorPanelProps) => {
  const markdownContent = useMemo(() => {
    if (!activeNote) {
      return '';
    }
    return convertWikiLinks(activeNote.content);
  }, [activeNote]);

  if (!activeNote) {
    return <div className="empty">Open a note to start editing.</div>;
  }

  return (
    <>
      <div className="note-actions">
        <div className="note-actions-title">{activeNote.title}</div>
        <div className="note-actions-buttons">
          <button onClick={() => activeNode && onRename(activeNode)}>Rename</button>
          <button onClick={() => activeNode && onMove(activeNode)}>Move</button>
        </div>
      </div>
      <div className={`editor-preview ${viewMode}`}>
        {(viewMode === 'split' || viewMode === 'editor') && (
          <textarea
            value={activeNote.content}
            onChange={(event) => onUpdateContent(activeNote.path, event.target.value)}
          />
        )}
        {(viewMode === 'split' || viewMode === 'preview') && (
          <div className="preview">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) => (
                  <a {...props} href={href} onClick={(event) => onLinkClick(href, event)}>
                    {children}
                  </a>
                ),
                blockquote: ({ children }) => {
                  const text = children?.[0]?.toString?.() ?? '';
                  const match = /\[!([A-Z]+)\]/.exec(text);
                  if (match) {
                    return <div className={`callout callout-${match[1].toLowerCase()}`}>{children}</div>;
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
  );
};

export default EditorPanel;
