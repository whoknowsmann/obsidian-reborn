import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import type { SearchResult, TemplateSummary } from '../types';

type PaletteMode = 'command' | 'open-note' | 'create-note' | 'insert-template' | 'new-note-template';

type CommandItem = {
  id: string;
  label: string;
  description: string;
  onSelect: () => void;
};

type QuickSwitchResponse = {
  results: SearchResult[];
  hasExactMatch: boolean;
};

type PaletteListItem =
  | { type: 'command'; command: CommandItem }
  | { type: 'note'; note: SearchResult }
  | { type: 'create'; title: string }
  | { type: 'template'; template: TemplateSummary };

const fuzzyScore = (query: string, target: string) => {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) {
    return 1;
  }
  const normalizedTarget = target.toLowerCase();
  let score = 0;
  let lastMatch = -1;
  for (const char of normalizedQuery) {
    const index = normalizedTarget.indexOf(char, lastMatch + 1);
    if (index === -1) {
      return 0;
    }
    score += index === lastMatch + 1 ? 2 : 1;
    lastMatch = index;
  }
  return score / normalizedTarget.length;
};

const CommandPalette = memo(
  ({
    open,
    onClose,
    onOpenNote,
    onCreateNote,
    onTogglePreview,
    onToggleSplit,
    onOpenDaily,
    onOpenGraph,
    onOpenGlobalGraph,
    templates,
    onInsertTemplate,
    onCreateNoteFromTemplate
  }: {
    open: boolean;
    onClose: () => void;
    onOpenNote: (path: string, options?: { openInNewTab?: boolean }) => void;
    onCreateNote: (title: string) => Promise<void>;
    onTogglePreview: () => void;
    onToggleSplit: () => void;
    onOpenDaily: () => Promise<void>;
    onOpenGraph: () => void;
    onOpenGlobalGraph: () => void;
    templates: TemplateSummary[];
    onInsertTemplate: (template: TemplateSummary) => Promise<void>;
    onCreateNoteFromTemplate: (template: TemplateSummary) => Promise<void>;
  }) => {
    const [mode, setMode] = useState<PaletteMode>('open-note');
    const [query, setQuery] = useState('');
    const [noteResults, setNoteResults] = useState<SearchResult[]>([]);
    const [hasExactMatch, setHasExactMatch] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const resetPalette = useCallback(() => {
      setMode('open-note');
      setQuery('');
      setNoteResults([]);
      setHasExactMatch(false);
      setActiveIndex(0);
    }, []);

    const switchMode = useCallback((nextMode: PaletteMode) => {
      setMode(nextMode);
      setQuery('');
      setNoteResults([]);
      setHasExactMatch(false);
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }, []);

    useEffect(() => {
      if (open) {
        resetPalette();
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    }, [open, resetPalette]);

    useEffect(() => {
      if (!open || mode === 'create-note') {
        return;
      }
      const trimmed = query.trimStart();
      const wantsCommands = trimmed.startsWith('>');
      if (wantsCommands && mode !== 'command') {
        setMode('command');
      }
      if (!wantsCommands && mode === 'command') {
        setMode('open-note');
      }
    }, [open, mode, query]);

    const commandQuery = useMemo(() => query.replace(/^>\s*/, ''), [query]);

    useEffect(() => {
      if (!open || mode !== 'open-note') {
        return;
      }
      if (!query.trim()) {
        setNoteResults([]);
        setHasExactMatch(false);
        return;
      }
      const timeout = window.setTimeout(async () => {
        const response = (await window.vaultApi.quickSwitch(query)) as QuickSwitchResponse;
        setNoteResults(response.results);
        setHasExactMatch(response.hasExactMatch);
        setActiveIndex(0);
      }, 60);
      return () => window.clearTimeout(timeout);
    }, [open, mode, query]);

    const commandItems = useMemo<CommandItem[]>(() => {
      const items: CommandItem[] = [
        {
          id: 'open-note',
          label: 'Open Note',
          description: 'Quick switcher for notes',
          onSelect: () => switchMode('open-note')
        },
        {
          id: 'create-note',
          label: 'Create Note',
          description: 'Create a new note in the vault',
          onSelect: () => switchMode('create-note')
        },
        {
          id: 'toggle-preview',
          label: 'Toggle Preview',
          description: 'Switch between preview and split',
          onSelect: () => {
            onTogglePreview();
            onClose();
          }
        },
        {
          id: 'toggle-split',
          label: 'Toggle Split View',
          description: 'Switch between split and editor',
          onSelect: () => {
            onToggleSplit();
            onClose();
          }
        },
        {
          id: 'daily-note',
          label: 'Open Daily Note',
          description: 'Open today’s daily note',
          onSelect: async () => {
            await onOpenDaily();
            onClose();
          }
        },
        {
          id: 'open-graph',
          label: 'Open Graph View',
          description: 'Show the local graph for the current note',
          onSelect: () => {
            onOpenGraph();
            onClose();
          }
        },
        {
          id: 'open-global-graph',
          label: 'Open Global Graph',
          description: 'Show the global graph for the entire vault',
          onSelect: () => {
            onOpenGlobalGraph();
            onClose();
          }
        },
        {
          id: 'insert-template',
          label: 'Insert Template',
          description: 'Insert a template at the cursor',
          onSelect: () => switchMode('insert-template')
        },
        {
          id: 'new-note-from-template',
          label: 'New Note from Template',
          description: 'Create a note populated with a template',
          onSelect: () => switchMode('new-note-template')
        }
      ];
      if (!commandQuery.trim()) {
        return items;
      }
      return items
        .map((item) => ({
          item,
          score: fuzzyScore(commandQuery, `${item.label} ${item.description}`)
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ item }) => item);
    }, [
      commandQuery,
      onClose,
      onOpenDaily,
      onOpenGraph,
      onOpenGlobalGraph,
      onTogglePreview,
      onToggleSplit,
      switchMode
    ]);

    const noteItems = useMemo<PaletteListItem[]>(() => {
      if (mode !== 'open-note') {
        return [];
      }
      const trimmed = query.trim();
      const items: PaletteListItem[] = noteResults.map((note) => ({ type: 'note', note }));
      if (trimmed && !hasExactMatch) {
        items.unshift({ type: 'create', title: trimmed });
      }
      return items;
    }, [mode, noteResults, query, hasExactMatch]);

    const commandListItems = useMemo<PaletteListItem[]>(
      () => commandItems.map((command) => ({ type: 'command', command })),
      [commandItems]
    );

    const templateItems = useMemo<PaletteListItem[]>(() => {
      if (mode !== 'insert-template' && mode !== 'new-note-template') {
        return [];
      }
      const trimmed = query.trim();
      const ranked = templates
        .map((template) => ({
          template,
          score: trimmed ? fuzzyScore(trimmed, template.title) : 1
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ template }) => ({ type: 'template', template }) as PaletteListItem);
      return ranked;
    }, [mode, query, templates]);

    const activeItems =
      mode === 'command'
        ? commandListItems
        : mode === 'open-note'
        ? noteItems
        : mode === 'insert-template' || mode === 'new-note-template'
        ? templateItems
        : [];
    const activeCount = activeItems.length;

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % Math.max(activeCount, 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + Math.max(activeCount, 1)) % Math.max(activeCount, 1));
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (mode !== 'open-note') {
          switchMode('open-note');
          return;
        }
        onClose();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const isNewTab = event.metaKey || event.ctrlKey;
        if (mode === 'command') {
          const target = commandItems[activeIndex];
          target?.onSelect();
          return;
        }
        if (mode === 'open-note') {
          const target = activeItems[activeIndex];
          if (!target) {
            return;
          }
          if (target.type === 'note') {
            onOpenNote(target.note.path, { openInNewTab: isNewTab });
            onClose();
            return;
          }
          if (target.type === 'create') {
            void onCreateNote(target.title).then(onClose);
          }
          return;
        }
        if (mode === 'create-note' && query.trim()) {
          void onCreateNote(query.trim()).then(onClose);
        }
        if (mode === 'insert-template' || mode === 'new-note-template') {
          const target = activeItems[activeIndex];
          if (!target || target.type !== 'template') {
            return;
          }
          if (mode === 'insert-template') {
            void onInsertTemplate(target.template).then(onClose);
          } else {
            void onCreateNoteFromTemplate(target.template).then(onClose);
          }
        }
      }
    };

    if (!open) {
      return null;
    }

    return (
      <div className="palette-overlay" onClick={onClose}>
        <div className="palette" onClick={(event) => event.stopPropagation()}>
          <div className="palette-header">
            <span className="palette-mode">
              {mode === 'command' && 'Commands'}
              {mode === 'open-note' && 'Quick Switcher'}
              {mode === 'create-note' && 'Create Note'}
              {mode === 'insert-template' && 'Insert Template'}
              {mode === 'new-note-template' && 'New Note from Template'}
            </span>
            <span className="palette-hint">Esc to close · ↑/↓ to navigate</span>
          </div>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={
              mode === 'command'
                ? 'Type a command...'
                : mode === 'open-note'
                ? 'Search notes or type > for commands...'
                : mode === 'create-note'
                ? 'New note title...'
                : 'Search templates...'
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="palette-list">
            {mode === 'command' &&
              commandListItems.map((item, index) => (
                <button
                  key={item.command.id}
                  className={`palette-item ${index === activeIndex ? 'active' : ''}`}
                  onClick={item.command.onSelect}
                >
                  <div className="palette-item-title">{item.command.label}</div>
                  <div className="palette-item-desc">{item.command.description}</div>
                </button>
              ))}
            {mode === 'open-note' &&
              noteItems.map((item, index) => (
                <button
                  key={item.type === 'note' ? item.note.id : `create-${item.title}`}
                  className={`palette-item ${index === activeIndex ? 'active' : ''}`}
                  onClick={() => {
                    if (item.type === 'note') {
                      onOpenNote(item.note.path);
                      onClose();
                      return;
                    }
                    if (item.type === 'create') {
                      void onCreateNote(item.title).then(onClose);
                    }
                  }}
                >
                  <div className="palette-item-title">
                    {item.type === 'note' ? item.note.title : `Create “${item.title}”`}
                  </div>
                  <div className="palette-item-desc">
                    {item.type === 'note'
                      ? item.note.displayPath ?? item.note.path
                      : 'Create a new note with this title'}
                  </div>
                </button>
              ))}
            {mode === 'create-note' && (
              <div className="palette-empty">
                Press Enter to create <strong>{query.trim() || 'a new note'}</strong>.
              </div>
            )}
            {(mode === 'insert-template' || mode === 'new-note-template') &&
              templateItems.map((item, index) => (
                <button
                  key={item.template.path}
                  className={`palette-item ${index === activeIndex ? 'active' : ''}`}
                  onClick={() => {
                    if (mode === 'insert-template') {
                      void onInsertTemplate(item.template).then(onClose);
                    } else {
                      void onCreateNoteFromTemplate(item.template).then(onClose);
                    }
                  }}
                >
                  <div className="palette-item-title">{item.template.title}</div>
                  <div className="palette-item-desc">{item.template.path}</div>
                </button>
              ))}
            {mode !== 'create-note' && activeCount === 0 && (
              <div className="palette-empty">No results.</div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

CommandPalette.displayName = 'CommandPalette';

export default CommandPalette;
