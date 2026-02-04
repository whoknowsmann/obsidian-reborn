# Argus Vault (MVP)

A local-first, Obsidian-like markdown vault app built with Electron + React + TypeScript. It provides fast vault browsing, live preview, wikilinks, tabs, backlinks, and global search.

## Install & Run

```bash
npm install
npm run dev
```

## Architecture Overview

- **Electron main process**: Owns filesystem access, vault settings persistence, file watching, and search/backlink indexing.
- **Preload bridge**: Exposes a minimal, typed API to the renderer for safe IPC.
- **React renderer**: Renders the UI (file tree, tabs, editor/preview, search, backlinks) and handles user interaction.

### Renderer Structure

- `src/App.tsx`: App orchestration and state wiring.
- `src/components/`: UI building blocks split by surface area.
  - `TopBar`: vault controls + global search + view mode toggle.
  - `Sidebar`: vault tree + file/folder actions.
  - `TabBar`: open tabs + close behavior.
  - `EditorPanel`: editor + preview rendering + wikilink click handling.
  - `RightSidebar`: backlinks list.
  - `CommandPalette`: quick switcher + command palette.
  - `RenameModal`: rename preview/apply dialog.
  - `AppErrorBoundary`: crash fallback UI with debug copy.
- `src/utils/`: shared helpers for note metadata and tree traversal.

## Key Design Decisions

- **Local-only**: All file operations happen locally via Electron IPC; no network or cloud dependencies.
- **Search indexing in main**: `MiniSearch` indexes title/content for fast global search without freezing the UI.
- **Simple wikilink support**: `[[Note]]` and `[[Note|Alias]]` are converted to clickable links in preview.
- **Autosave by default**: Debounced writes keep edits safe without a manual save button.
- **Theme tokens**: UI colors are driven by CSS variables so light/dark themes can be swapped without per-component styling.

## Theming (CSS Variables)

Themes are defined via CSS variables on the `body` element (`theme-dark` or `theme-light`). Core tokens include:

- `--bg`, `--fg`, `--muted`, `--border`, `--accent`
- `--sidebar-bg`, `--panel-bg`, `--editor-bg`, `--tab-bg`

All surfaces (sidebar, tabs, editor, preview, properties, backlinks, palette, graph view) read from these tokens so the theme can be changed globally. You can adjust the editor font size via the `--editor-font-size` variable as well.

## Settings

Settings live in the Electron user data directory at `settings.json` (via `app.getPath('userData')`). Current keys:

- `theme`: `"dark"` or `"light"`
- `editorFontSize`: numeric pixel value
- `lastVault`: last opened vault path
- `templatesPath`: optional override for where templates live (defaults to `/Templates` in the vault when it exists)
- `starredPaths`: array of absolute note paths that are starred

Updates are saved immediately when toggling theme or adjusting font size.

## Embeds

Preview supports Obsidian-style embeds:

- `![[Note Name]]` (note embed)
- `![[Note Name#Heading]]` (heading embed)
- `![[path/to/file.png]]` (image embed)

Embeds render as contained blocks in preview. Missing targets show a “Missing embed target” placeholder, and embed rendering is depth-capped to avoid infinite recursion.

## Graph View

The Graph View shows a **local graph**: the current note plus its 1-hop neighbors (outgoing links and backlinks). It uses a lightweight SVG radial layout (no physics) and is meant to be fast. Use the top bar “Graph” button or the command palette command “Open Graph View” to open it.

You can also open a **global graph** from the command palette via “Open Global Graph”. To keep performance snappy, the graph is capped at 1000 nodes and 3000 edges. If your vault exceeds those caps, a subset is shown with a warning.

## Tags, Outline, and Callouts

- **Tags**: Use `#tag` or `#tag/subtag` in note bodies. Tags inside fenced code blocks are ignored. Tags are surfaced in the right sidebar with counts, and clicking a tag shows matching notes.
- **Tag search**: Use `tag:foo` or `tag:foo/bar` in the global search box. Combine with text terms like `tag:foo release plan`.
- **Outline panel**: The right sidebar shows headings (H1–H6) extracted from the current note (code fences ignored). Clicking a heading jumps to that section in the editor or scrolls the preview in preview-only mode.
- **Callouts**: Obsidian-style callouts render in preview using:
  ```
  > [!note] Optional title
  > Callout content...
  ```
  Supported types: `note`, `info`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`.

## Key Logic Locations

- **Vault index + link updates**: Electron main process in `electron/main.ts`.
- **Vault/tree operations**: `window.vaultApi` bridge in `electron/preload.ts`.
- **Editor + preview rendering**: `src/components/EditorPanel.tsx`.
- **Link conversion + note utilities**: `src/utils/notes.ts`.
- **Tree traversal helpers**: `src/utils/tree.ts`.

## Command Palette + Quick Switcher

Open the command palette with **Ctrl/Cmd + P**. It opens in Quick Switcher mode by default (note search). You can type `>` to switch to command mode. From there you can:

- **Open Note**: fuzzy-search note titles and press Enter to open.
- **Create Note**: if no title matches, choose “Create ‘<title>’” or use the Create Note command.
- **Toggle Preview** / **Toggle Split View**.
- **Open Daily Note**: opens today’s note (creates it if missing, stored in `/Daily` when the folder exists).
- **Insert Template**: inserts a Markdown template at the editor cursor.
- **New Note from Template**: prompts for a title and creates a new note from the chosen template.

While the palette is open, use ↑/↓ to navigate results, **Esc** to close, and **Ctrl/Cmd + Enter** to open a note in a new tab.

## Keyboard Shortcuts

- **Ctrl/Cmd + P**: Open command palette (quick switcher).
- **Ctrl/Cmd + N**: New note (creates in the selected folder if one is highlighted, otherwise in the vault root).
- **Ctrl/Cmd + W**: Close current tab (prompts if a recent edit hasn't finished autosaving).
- **Ctrl/Cmd + Tab**: Next tab.
- **Ctrl/Cmd + Shift + Tab**: Previous tab.

Note: **Ctrl/Cmd + W** and **Ctrl/Cmd + Tab** override their usual OS/browser behaviors within the app to manage tabs.

## Editor

The editor is powered by **CodeMirror 6** for lightweight, extensible Markdown syntax highlighting (including code fences) without the heavier footprint of Monaco. Line wrapping is enabled by default, and the editor font size can be styled via the `--editor-font-size` CSS variable for future settings support.

## Link Updates on Rename/Move

When a note is renamed or moved, the app will scan the backlink graph to find every note that
resolves to that specific file and rewrite only the wikilink token:

- `[[Old Title]]` → `[[New Title]]`
- `[[Old Title|Alias]]` → `[[New Title|Alias]]` (aliases are preserved)
- Embeds follow the same rule: `![[Old Title]]` → `![[New Title]]`

Before applying changes, a confirmation modal shows the number of files to update and a preview
list of affected paths.

### Title Resolution Rules

- **Title = filename without `.md`** (folder names are not part of the title).
- Links resolve by normalized title (trimmed + lowercase) and are mapped to a single file path.
- If multiple notes share the same title, links resolve to the file the index currently maps to.
  During rename, only links that resolve to the exact file being renamed are rewritten.

## Manual QA Checklist

If you don't have automated tests handy, validate these flows:

1. Toggle the theme between dark/light and confirm all surfaces update.
2. Adjust the editor font size slider and verify CodeMirror text updates immediately.
3. Click “Change vault” in Settings and ensure the vault picker opens.
4. Open the command palette and run “Open Graph View”.
5. Click the top bar “Graph” button to open the graph modal.
6. Click a graph node and confirm the note opens in a tab.
7. Open a note, edit content, and verify autosave works (no data loss).
8. Rename a note with backlinks and confirm links update.
9. Move a note into a folder and confirm links still resolve.
10. Switch tabs with Ctrl/Cmd + Tab and verify focus changes.

## Known Limitations

- No drag-and-drop reordering in the file tree.

## Next Steps

- Smarter conflict handling if files are edited externally.

## Templates

Templates are Markdown files in the Templates folder. By default the app uses `/Templates` inside the vault if it exists, or you can set a custom path in Settings.

Supported variables (simple replacements):

- `{{title}}` → current note title (or the new note title)
- `{{date:YYYY-MM-DD}}` → date string (format tokens: `YYYY`, `MM`, `DD`)
- `{{time:HH:mm}}` → time string (format tokens: `HH`, `mm`)

Use the command palette command “Insert Template” to insert a template into the current note, or “New Note from Template” to create a fresh note populated by a template.

## Starred Notes

Click the star icon in the tab bar or the note header to toggle a star. Starred notes show up in the left sidebar under “Starred”. Starred note paths are stored in `settings.json` under `starredPaths` (not inside the Markdown files).
