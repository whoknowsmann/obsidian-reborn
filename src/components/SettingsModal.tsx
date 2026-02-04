import type { AppSettings, ThemeMode } from '../types';

type SettingsModalProps = {
  open: boolean;
  settings: AppSettings;
  vaultPath: string | null;
  onClose: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onChangeVault: () => void;
};

const clampFontSize = (value: number) => Math.min(20, Math.max(12, value));

const SettingsModal = ({
  open,
  settings,
  vaultPath,
  onClose,
  onUpdateSettings,
  onChangeVault
}: SettingsModalProps) => {
  if (!open) {
    return null;
  }

  const handleFontSizeChange = (value: number) => {
    onUpdateSettings({
      ...settings,
      editorFontSize: clampFontSize(value)
    });
  };

  const setTheme = (theme: ThemeMode) => {
    onUpdateSettings({
      ...settings,
      theme
    });
  };

  const handleTemplatesPathChange = (value: string) => {
    onUpdateSettings({
      ...settings,
      templatesPath: value.trim() ? value.trim() : null
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">Settings</div>
        <div className="settings-section">
          <div className="settings-row">
            <div>
              <div className="settings-label">Editor font size</div>
              <div className="settings-muted">Adjusts CodeMirror font size instantly.</div>
            </div>
            <div className="settings-control">
              <input
                type="range"
                min={12}
                max={20}
                step={1}
                value={settings.editorFontSize}
                onChange={(event) => handleFontSizeChange(Number(event.target.value))}
              />
              <span className="settings-value">{settings.editorFontSize}px</span>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">Theme</div>
              <div className="settings-muted">Choose a light or dark appearance.</div>
            </div>
            <div className="settings-control">
              <div className="theme-toggle">
                <button
                  className={settings.theme === 'dark' ? 'active' : ''}
                  onClick={() => setTheme('dark')}
                >
                  Dark
                </button>
                <button
                  className={settings.theme === 'light' ? 'active' : ''}
                  onClick={() => setTheme('light')}
                >
                  Light
                </button>
              </div>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">Vault location</div>
              <div className="settings-muted">
                {vaultPath ?? 'No vault selected yet.'}
              </div>
            </div>
            <div className="settings-control">
              <button onClick={onChangeVault}>Change vault</button>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">Templates folder</div>
              <div className="settings-muted">
                Defaults to {vaultPath ? `${vaultPath}/Templates` : '/Templates'} when available.
              </div>
            </div>
            <div className="settings-control">
              <input
                type="text"
                placeholder={vaultPath ? `${vaultPath}/Templates` : '/Templates'}
                value={settings.templatesPath ?? ''}
                onChange={(event) => handleTemplatesPathChange(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
