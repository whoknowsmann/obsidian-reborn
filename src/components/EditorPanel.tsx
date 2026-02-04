import {
  Children,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { OpenNote, OutlineHeading, ThemeMode, TreeNode, ViewMode } from '../types';
import { createSlugger } from '../utils/markdown';
import { convertWikiLinks } from '../utils/notes';
import EditorAdapter, { type EditorAdapterHandle } from './EditorAdapter';

type EditorPanelProps = {
  activeNote: OpenNote | null;
  activeNode: TreeNode | null;
  viewMode: ViewMode;
  themeMode: ThemeMode;
  onUpdateContent: (path: string, content: string) => void;
  onRename: (node: TreeNode) => void;
  onMove: (node: TreeNode) => void;
  onLinkClick: (href?: string, event?: MouseEvent) => void;
  onOpenWikiLink: (linkText: string) => void;
};

export type EditorPanelHandle = {
  jumpToHeading: (heading: OutlineHeading) => void;
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

const EditorPanel = forwardRef<EditorPanelHandle, EditorPanelProps>(
  (
    {
      activeNote,
      activeNode,
      viewMode,
      themeMode,
      onUpdateContent,
      onRename,
      onMove,
      onLinkClick,
      onOpenWikiLink
    },
    ref
  ) => {
    const markdownContent = useMemo(() => {
      if (!activeNote) {
        return '';
      }
      return convertWikiLinks(activeNote.content);
    }, [activeNote]);
    const editorRef = useRef<EditorAdapterHandle | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const slugger = useMemo(() => createSlugger(), [markdownContent]);

    const flattenText = (value: ReactNode): string => {
      if (typeof value === 'string') {
        return value;
      }
      if (Array.isArray(value)) {
        return value.map(flattenText).join('');
      }
      if (value && typeof value === 'object' && 'props' in value) {
        return flattenText((value as { props?: { children?: ReactNode } }).props?.children);
      }
      return '';
    };

    const renderCallout = (children: ReactNode) => {
      const childArray = Children.toArray(children);
      const firstChild = childArray[0];
      if (!firstChild || typeof firstChild !== 'object' || !('props' in firstChild)) {
        return null;
      }
      const firstText = flattenText((firstChild as { props?: { children?: ReactNode } }).props?.children);
      const match = /^\s*\[!([a-zA-Z]+)\]\s*(.*)$/.exec(firstText);
      if (!match) {
        return null;
      }
      const type = match[1].toLowerCase();
      const title = match[2]?.trim() || `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
      const contentChildren = childArray.slice(1);
      return (
        <div className="callout" data-callout={type}>
          <div className="callout-header">{title}</div>
          {contentChildren.length > 0 && <div className="callout-content">{contentChildren}</div>}
        </div>
      );
    };

    const renderHeading =
      (level: 1 | 2 | 3 | 4 | 5 | 6) =>
      ({ children }: { children?: ReactNode }) => {
        const text = flattenText(children);
        const slug = slugger(text);
        const Tag = `h${level}` as const;
        return <Tag id={slug}>{children}</Tag>;
      };

    useImperativeHandle(ref, () => ({
      jumpToHeading: (heading: OutlineHeading) => {
        if (viewMode !== 'preview') {
          editorRef.current?.scrollToLine(heading.line);
          return;
        }
        const container = previewRef.current;
        if (!container) {
          return;
        }
        const target = container.querySelector(`#${CSS.escape(heading.slug)}`);
        if (target instanceof HTMLElement) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }));

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
            <EditorAdapter
              ref={editorRef}
              value={activeNote.content}
              onChange={(next) => onUpdateContent(activeNote.path, next)}
              onCtrlClickLink={onOpenWikiLink}
              themeMode={themeMode}
            />
          )}
          {(viewMode === 'split' || viewMode === 'preview') && (
            <div className="preview" ref={previewRef}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...props }) => (
                    <a {...props} href={href} onClick={(event) => onLinkClick(href, event)}>
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) =>
                    renderCallout(children) ?? <blockquote>{children}</blockquote>,
                  h1: renderHeading(1),
                  h2: renderHeading(2),
                  h3: renderHeading(3),
                  h4: renderHeading(4),
                  h5: renderHeading(5),
                  h6: renderHeading(6)
                }}
              >
                {markdownContent}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </>
    );
  }
);

export default EditorPanel;
