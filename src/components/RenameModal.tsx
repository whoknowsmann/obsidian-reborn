import type { RenamePreview } from '../types';

type RenameFailureDetails = {
  updatedFiles: string[];
  failedFiles: string[];
};

type RenameModalProps = {
  renamePlan: RenamePreview | null;
  renameModalOpen: boolean;
  renameApplyWithoutPreview: boolean;
  renameApplying: boolean;
  renameError: string | null;
  renameFailureDetails: RenameFailureDetails | null;
  onClose: () => void;
  onApply: () => void;
  onToggleApplyWithoutPreview: (value: boolean) => void;
};

const RenameModal = ({
  renamePlan,
  renameModalOpen,
  renameApplyWithoutPreview,
  renameApplying,
  renameError,
  renameFailureDetails,
  onClose,
  onApply,
  onToggleApplyWithoutPreview
}: RenameModalProps) => {
  if (!renameModalOpen || !renamePlan) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          Rename note: {renamePlan.oldTitle} → {renamePlan.newTitle}
        </div>
        <div className="modal-subtitle">Files to update: {renamePlan.affectedFiles.length}</div>
        {renamePlan.affectedFiles.length > 25 && (
          <label className="modal-toggle">
            <input
              type="checkbox"
              checked={renameApplyWithoutPreview}
              onChange={(event) => onToggleApplyWithoutPreview(event.target.checked)}
            />
            Apply without preview
          </label>
        )}
        {!renameApplyWithoutPreview && renamePlan.affectedFiles.length > 0 && (
          <ul className="modal-list">
            {renamePlan.affectedFiles.map((filePath) => (
              <li key={filePath}>{filePath}</li>
            ))}
          </ul>
        )}
        {renameError && (
          <div className="modal-error">
            <strong>{renameError}</strong>
            {renameFailureDetails && (
              <div className="modal-error-details">
                <div>Updated: {renameFailureDetails.updatedFiles.length}</div>
                <div>Not updated: {renameFailureDetails.failedFiles.length}</div>
                {renameFailureDetails.updatedFiles.length > 0 && (
                  <ul>
                    {renameFailureDetails.updatedFiles.map((filePath) => (
                      <li key={filePath}>{filePath}</li>
                    ))}
                  </ul>
                )}
                {renameFailureDetails.failedFiles.length > 0 && (
                  <ul>
                    {renameFailureDetails.failedFiles.map((filePath) => (
                      <li key={filePath}>{filePath}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose} disabled={renameApplying}>
            Cancel
          </button>
          <button onClick={onApply} disabled={renameApplying}>
            {renameApplying ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RenameModal;
export type { RenameFailureDetails };
