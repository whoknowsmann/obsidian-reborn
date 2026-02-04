import type { SearchResult, ViewMode } from '../types';
import { ViewModeToggle } from './EditorPanel';

type TopBarProps = {
  vaultPath: string | null;
  onSelectVault: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchResults: SearchResult[];
  onOpenNote: (path: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
};

const TopBar = ({
  vaultPath,
  onSelectVault,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  onOpenNote,
  viewMode,
  onViewModeChange
}: TopBarProps) => (
  <header className="top-bar">
    <div className="vault-controls">
      <button onClick={onSelectVault}>Open Vault</button>
      <span>{vaultPath ?? 'No vault selected'}</span>
    </div>
    <div className="search">
      <input
        placeholder="Search vault..."
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
      />
      {searchResults.length > 0 && (
        <div className="search-results">
          {searchResults.map((result) => (
            <button key={result.id} className="search-result" onClick={() => onOpenNote(result.path)}>
              <strong>{result.title}</strong>
              <span>{result.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
    <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
  </header>
);

export default TopBar;
