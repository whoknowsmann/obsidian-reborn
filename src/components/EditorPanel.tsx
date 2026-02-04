import {
  Children,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { OpenNote, OutlineHeading, ThemeMode, TreeNode, ViewMode } from '../types';
import { createSlugger } from '../utils/markdown';
import { convertWikiLinks, isAbsolutePath, normalizeTitle } from '../utils/notes';
import EditorAdapter, { type EditorAdapterHandle } from './EditorAdapter';

type EditorPanelProps = {
  vaultPath: string | null;
  activeNote: OpenNote | null;
  activeNode: TreeNode | null;
  viewMode: ViewMode;
  themeMode: ThemeMode;
  onUpdateContent: (path: string, content: string) => void;
  onRename: (node: TreeNode) => void;
  onMove: (node: TreeNode) => void;
  onToggleStar: (path: string) => void;
  isStarred: boolean;
  onLinkClick: (href?: string, event?: MouseEvent) => void;
  onOpenWikiLink: (linkText: string) => void;
  vaultChangeToken: number;
};

export type EditorPanelHandle = {
  jumpToHeading: (heading: OutlineHeading) => void;
  insertText: (text: string) => boolean;
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
      vaultPath,
      activeNote,
      activeNode,
      viewMode,
      themeMode,
      onUpdateContent,
      onRename,
      onMove,
      onToggleStar,
      isStarred,
      onLinkClick,
      onOpenWikiLink,
      vaultChangeToken
    },
    ref
  ) => {
    const markdownContent = useMemo(() => activeNote?.content ?? '', [activeNote]);
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
      (headingSlugger: ReturnType<typeof createSlugger>, level: 1 | 2 | 3 | 4 | 5 | 6) =>
      ({ children }: { children?: ReactNode }) => {
        const text = flattenText(children);
        const slug = headingSlugger(text);
        const Tag = `h${level}` as const;
        return <Tag id={slug}>{children}</Tag>;
      };

    const extractHeadingSection = (content: string, heading: string) => {
      const lines = content.split(/\r?\n/);
      const normalizedHeading = heading.trim().toLowerCase();
      let startIndex = -1;
      let headingLevel = 0;
      for (let index = 0; index < lines.length; index += 1) {
        const match = /^(#{1,6})\s+(.*)$/.exec(lines[index].trim());
        if (!match) {
          continue;
        }
        const title = match[2].trim().toLowerCase();
        if (title === normalizedHeading) {
          startIndex = index;
          headingLevel = match[1].length;
          break;
        }
      }
      if (startIndex === -1) {
        return null;
      }
      let endIndex = lines.length;
      for (let index = startIndex + 1; index < lines.length; index += 1) {
        const match = /^(#{1,6})\s+/.exec(lines[index].trim());
        if (match && match[1].length <= headingLevel) {
          endIndex = index;
          break;
        }
      }
      return lines.slice(startIndex, endIndex).join('\n');
    };

    const resolveEmbedPath = (target: string) => {
      if (isAbsolutePath(target)) {
        return target;
      }
      if (!vaultPath) {
        return null;
      }
      return `${vaultPath}/${target}`;
    };

    const isImageEmbed = (target: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(target);

    const renderMarkdownContent = (
      content: string,
      depth: number,
      visited: Set<string>,
      headingSlugger = createSlugger()
    ): JSX.Element => {
      return (
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
            img: ({ src, alt, ...props }) => {
              if (src && src.startsWith('embed:')) {
                const target = decodeURIComponent(src.slice('embed:'.length));
                return (
                  <EmbedBlock
                    target={target}
                    depth={depth + 1}
                    visited={visited}
                  />
                );
              }
              return <img {...props} src={src} alt={alt} />;
            },
            h1: renderHeading(headingSlugger, 1),
            h2: renderHeading(headingSlugger, 2),
            h3: renderHeading(headingSlugger, 3),
            h4: renderHeading(headingSlugger, 4),
            h5: renderHeading(headingSlugger, 5),
            h6: renderHeading(headingSlugger, 6)
          }}
        >
          {convertWikiLinks(content)}
        </ReactMarkdown>
      );
    };

    const EmbedBlock = ({
      target,
      depth,
      visited
    }: {
      target: string;
      depth: number;
      visited: Set<string>;
    }) => {
      const [content, setContent] = useState<string | null>(null);
      const [errorMessage, setErrorMessage] = useState<string | null>(null);
      const [imageSrc, setImageSrc] = useState<string | null>(null);
      const [loading, setLoading] = useState(true);
      const [resolvedPath, setResolvedPath] = useState<string | null>(null);
      const depthLimit = 3;
      const visitedKey = Array.from(visited).join('|');

      useEffect(() => {
        let isActive = true;
        const loadEmbed = async () => {
          setLoading(true);
          setErrorMessage(null);
          setImageSrc(null);
          setContent(null);
          if (depth > depthLimit) {
            setErrorMessage('Embed depth limit reached');
            setLoading(false);
            return;
          }
          const [targetValue, heading] = target.split('#');
          const trimmedTarget = targetValue.trim();
          if (!trimmedTarget) {
            setErrorMessage('Missing embed target');
            setLoading(false);
            return;
          }
          if (isImageEmbed(trimmedTarget)) {
            const resolvedPath = resolveEmbedPath(trimmedTarget);
            const url = resolvedPath ? `file://${encodeURI(resolvedPath)}` : null;
            if (url && isActive) {
              setImageSrc(url);
            } else if (isActive) {
              setErrorMessage('Missing embed target');
            }
            setResolvedPath(resolvedPath);
            setLoading(false);
            return;
          }
          let resolvedPath: string | null = null;
          const hasExtension = /\.[a-z0-9]+$/i.test(trimmedTarget);
          if (trimmedTarget.includes('/') || trimmedTarget.toLowerCase().endsWith('.md')) {
            const normalizedTarget =
              hasExtension || trimmedTarget.toLowerCase().endsWith('.md')
                ? trimmedTarget
                : `${trimmedTarget}.md`;
            resolvedPath = resolveEmbedPath(normalizedTarget);
          } else {
            resolvedPath = await window.vaultApi.openByTitle(normalizeTitle(trimmedTarget));
          }
          if (!resolvedPath) {
            setErrorMessage('Missing embed target');
            setLoading(false);
            return;
          }
          if (visited.has(resolvedPath)) {
            setErrorMessage('Embed cycle detected');
            setLoading(false);
            return;
          }
          setResolvedPath(resolvedPath);
          try {
            const raw = await window.vaultApi.readFile(resolvedPath);
            const extracted = heading ? extractHeadingSection(raw, heading) : raw;
            if (!extracted) {
              setErrorMessage('Missing embed heading');
            } else {
              setContent(extracted);
            }
          } catch {
            setErrorMessage('Missing embed target');
          } finally {
            setLoading(false);
          }
        };
        loadEmbed();
        return () => {
          isActive = false;
        };
      }, [target, depth, vaultChangeToken, visitedKey]);

      if (loading) {
        return <div className="embed-block embed-loading">Loading embed…</div>;
      }
      if (errorMessage) {
        return <div className="embed-block embed-missing">{errorMessage}</div>;
      }
      if (imageSrc) {
        return (
          <div className="embed-block embed-image">
            <img src={imageSrc} alt={target} />
          </div>
        );
      }
      if (content) {
        const nextVisited = new Set(visited);
        if (resolvedPath) {
          nextVisited.add(resolvedPath);
        }
        return <div className="embed-block">{renderMarkdownContent(content, depth, nextVisited)}</div>;
      }
      return <div className="embed-block embed-missing">Missing embed target</div>;
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
      },
      insertText: (text: string) => editorRef.current?.insertText(text) ?? false
    }));

    const rootVisited = useMemo(
      () => new Set(activeNote?.path ? [activeNote.path] : []),
      [activeNote?.path]
    );

    if (!activeNote) {
      return <div className="empty">Open a note to start editing.</div>;
    }

    return (
      <>
        <div className="note-actions">
          <div className="note-actions-title">{activeNote.title}</div>
          <div className="note-actions-buttons">
            <button
              className={`star-toggle ${isStarred ? 'active' : ''}`}
              onClick={() => onToggleStar(activeNote.path)}
              title={isStarred ? 'Remove star' : 'Star note'}
            >
              {isStarred ? '★' : '☆'}
            </button>
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
              {renderMarkdownContent(markdownContent, 0, rootVisited, slugger)}
            </div>
          )}
        </div>
      </>
    );
  }
);

export default EditorPanel;
