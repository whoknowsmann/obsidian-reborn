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

export type TagSummary = {
  tag: string;
  count: number;
};

export type OutlineHeading = {
  level: number;
  text: string;
  slug: string;
  line: number;
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

export type ThemeMode = 'dark' | 'light';

export type AppSettings = {
  theme: ThemeMode;
  editorFontSize: number;
  templatesPath?: string | null;
  starredPaths: string[];
};

export type TemplateSummary = {
  path: string;
  title: string;
};

export type GraphNode = {
  path: string;
  title: string;
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated?: boolean;
  totalEdges?: number;
  totalNodes?: number;
};
