# Link Explorer

A SiYuan dock panel that lists the current document's **outgoing links** and **backlinks**. Every item is clickable and opens the target block highlighted.

## Features

- **Outgoing links**: block references from the current document to other blocks or documents.
- **Backlinks**: block references from other blocks or documents to the current document.
- **Mentions**: document-level mentions of the current document title (via the backlink index).
- **External links**: `http(s)`, `mailto`, and `tel` links parsed from the document Markdown.
- **Asset references**: images, PDFs, and other `assets/...` references.
- **Dead links**: references whose target block no longer exists.
- **Direction labels**: outgoing shows `This document → target`; backlinks and mentions show `source → This document`.
- **Search**: filter by title, context, document name, or meta.
- **Grouping**: group items by source/target document; groups are collapsible.
- **Filters**: exclude daily notes, exclude self references, or only show the current notebook.
- **Scope**: switch between the whole document and the current block.
- **Hover preview**: show the full context of the hovered item at the bottom of the panel.
- **Health overview**: counts for every section, plus an “isolated document” badge. Click the badge to list documents in the current notebook with no outgoing links, backlinks, or mentions; click a category chip to jump to and highlight its section.
- **Keyboard navigation**: `ArrowUp` / `ArrowDown` move between items; `Enter` opens.
- **Settings**: choose visible sections, grouping, auto-refresh, maximum items, UI font size (10–25 px), and default filters.
- **Click behavior**: block references open the target block; external links open in the default browser; assets open in a SiYuan tab.
- **Right-click menu**: copy the block reference, open in a new tab, split right/bottom, or open the source/target document.

## Usage

1. Enable the plugin.
2. Open the **Link Explorer** dock from the right dock bar.
3. Open any document. The panel lists its links.
4. Click an item to jump to the target; hover to read the full context.

## Scope notes

- Mentions are document-level and are hidden in block scope.
- External and asset links are parsed from Markdown; they are not indexed by `refs`.
- Dead-link detection is based on `refs` entries whose `def_block_id` no longer exists in `blocks`.

## Data impact

- Reads `refs`, `blocks`, the backlink index, and the current document Markdown through read-only APIs.
- Does not write notes, block attributes, or workspace configuration.
- Does not make network requests (external links are only opened when clicked).

## Development

```bash
pnpm install
pnpm dev
pnpm check
pnpm build
```
