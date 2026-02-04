import type { OpenNote } from '../types';

type TabBarProps = {
  openNotes: OpenNote[];
  activePath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  starredPaths: string[];
  onToggleStar: (path: string) => void;
};

const TabBar = ({
  openNotes,
  activePath,
  onSelectTab,
  onCloseTab,
  starredPaths,
  onToggleStar
}: TabBarProps) => (
  <div className="tabs">
    {openNotes.map((note) => (
      <button
        key={note.path}
        className={`tab ${note.path === activePath ? 'active' : ''}`}
        onClick={() => onSelectTab(note.path)}
      >
        <span className="tab-title">
          {note.title}
          {note.dirty ? ' *' : ''}
        </span>
        <span
          className={`tab-star ${starredPaths.includes(note.path) ? 'active' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleStar(note.path);
          }}
          title={starredPaths.includes(note.path) ? 'Remove star' : 'Star note'}
        >
          {starredPaths.includes(note.path) ? '★' : '☆'}
        </span>
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
