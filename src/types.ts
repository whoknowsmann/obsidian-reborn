export type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
};

export type OpenNote = {
  path: string;
  title: string;
  content: string;
  dirty: boolean;
};

export type SearchResult = {
  id: string;
  title: string;
  path: string;
  displayPath?: string;
  score: number;
};

export type RenamePreview = {
  sourcePath: string;
  targetPath: string;
  oldTitle: string;
  newTitle: string;
  affectedFiles: string[];
};

export type RenameApplyResult = {
  ok: boolean;
  error?: string;
  sourcePath: string;
  targetPath: string;
  updatedFiles: string[];
  failedFiles: string[];
};

export type ViewMode = 'split' | 'editor' | 'preview';
