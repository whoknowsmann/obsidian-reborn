import type { OpenNote } from '../types';

type TabBarProps = {
  openNotes: OpenNote[];
  activePath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
};

const TabBar = ({ openNotes, activePath, onSelectTab, onCloseTab }: TabBarProps) => (
  <div className="tabs">
    {openNotes.map((note) => (
      <button
        key={note.path}
        className={`tab ${note.path === activePath ? 'active' : ''}`}
        onClick={() => onSelectTab(note.path)}
      >
        {note.title}
        {note.dirty ? ' *' : ''}
        <span
          className="tab-close"
          onClick={(event) => {
            event.stopPropagation();
            onCloseTab(note.path);
          }}
        >
          ✕
        </span>
      </button>
    ))}
  </div>
);

export default TabBar;
