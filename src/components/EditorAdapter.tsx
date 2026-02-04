import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { basicSetup } from 'codemirror';
import type { ThemeMode } from '../types';

const createEditorTheme = (themeMode: ThemeMode) =>
  EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--fg)'
      },
      '.cm-scroller': {
        overflow: 'auto'
      },
      '.cm-content': {
        padding: '16px',
        fontSize: 'var(--editor-font-size, 14px)',
        lineHeight: '1.5',
        fontFamily: 'inherit'
      },
      '.cm-gutters': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--muted)',
        border: 'none'
      }
    },
    { dark: themeMode === 'dark' }
  );

const findWikiLinkAt = (text: string, offset: number) => {
  const start = text.lastIndexOf('[[', offset);
  if (start === -1) {
    return null;
  }
  const end = text.indexOf(']]', offset);
  if (end === -1) {
    return null;
  }
  if (offset < start || offset > end) {
    return null;
  }
  const content = text.slice(start + 2, end);
  if (!content) {
    return null;
  }
  const [target] = content.split('|');
  const trimmed = target?.trim();
  return trimmed ? trimmed : null;
};

type EditorAdapterProps = {
  value: string;
  onChange: (next: string) => void;
  onCtrlClickLink?: (linkText: string) => void;
  themeMode: ThemeMode;
};

export type EditorAdapterHandle = {
  scrollToLine: (line: number) => void;
};

const EditorAdapter = forwardRef<EditorAdapterHandle, EditorAdapterProps>(
  ({ value, onChange, onCtrlClickLink, themeMode }, ref) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const ignoreNextChange = useRef(false);
    const onChangeRef = useRef(onChange);
    const onCtrlClickRef = useRef(onCtrlClickLink);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      onCtrlClickRef.current = onCtrlClickLink;
    }, [onCtrlClickLink]);

    useEffect(() => {
      if (!hostRef.current) {
        return;
      }

      const handleUpdate = (update: ViewUpdate) => {
        if (!update.docChanged) {
          return;
        }
        if (ignoreNextChange.current) {
          ignoreNextChange.current = false;
          return;
        }
        onChangeRef.current(update.state.doc.toString());
      };

      const handleMouseDown = (event: MouseEvent, view: EditorView) => {
        if (!(event.metaKey || event.ctrlKey)) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          return false;
        }
        const line = view.state.doc.lineAt(pos);
        const target = findWikiLinkAt(line.text, pos - line.from);
        if (!target) {
          return false;
        }
        event.preventDefault();
        onCtrlClickRef.current?.(target);
        return true;
      };

      const startState = EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown({ codeLanguages: languages }),
          EditorView.lineWrapping,
          createEditorTheme(themeMode),
          EditorView.updateListener.of(handleUpdate),
          EditorView.domEventHandlers({
            mousedown: handleMouseDown
          })
        ]
      });

      const view = new EditorView({
        state: startState,
        parent: hostRef.current
      });
      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, [themeMode]);

    useImperativeHandle(ref, () => ({
      scrollToLine: (line: number) => {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
        const targetLine = view.state.doc.line(clamped);
        view.dispatch({
          selection: { anchor: targetLine.from },
          scrollIntoView: true
        });
        view.focus();
      }
    }));

    useEffect(() => {
      const view = viewRef.current;
      if (!view) {
        return;
      }
      const currentValue = view.state.doc.toString();
      if (currentValue === value) {
        return;
      }
      ignoreNextChange.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value
        }
      });
    }, [value]);

    return <div className="editor-pane" ref={hostRef} />;
  }
);

export default EditorAdapter;
