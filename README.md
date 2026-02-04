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

## Key Design Decisions

- **Local-only**: All file operations happen locally via Electron IPC; no network or cloud dependencies.
- **Search indexing in main**: `MiniSearch` indexes title/content for fast global search without freezing the UI.
- **Simple wikilink support**: `[[Note]]` and `[[Note|Alias]]` are converted to clickable links in preview.
- **Autosave by default**: Debounced writes keep edits safe without a manual save button.

## Command Palette + Quick Switcher

Open the command palette with **Ctrl/Cmd + P**. It opens in Quick Switcher mode by default (note search). You can type `>` to switch to command mode. From there you can:

- **Open Note**: fuzzy-search note titles and press Enter to open.
- **Create Note**: if no title matches, choose “Create ‘<title>’” or use the Create Note command.
- **Toggle Preview** / **Toggle Split View**.
- **Open Daily Note**: opens today’s note (creates it if missing, stored in `/Daily` when the folder exists).

While the palette is open, use ↑/↓ to navigate results, **Esc** to close, and **Ctrl/Cmd + Enter** to open a note in a new tab.

## Known Limitations

- Callouts are basic and only detect `> [!TYPE]`-style blockquotes.
- File rename updates the filesystem, but open tabs may keep their old title until reopened.
- No drag-and-drop reordering in the file tree.

## Next Steps

- Graph view for backlinks.
- Smarter conflict handling if files are edited externally.
