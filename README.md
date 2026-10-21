# Link Overview

> See every link around the current document — outgoing links, backlinks, mentions, external links, assets, and dead links — all in one clickable panel.

Link Overview is a SiYuan dock panel. While you write, a document's connections are scattered everywhere: block references hide in the body, backlinks live in another pane, and external links only show up in the source. Link Overview gathers them all into one right-side panel: what this document links to, and what links back, is visible the moment you open it — and every entry jumps to its target in one click.

## Why use it

- **No more switching around**: outgoing links, backlinks, mentions, external links, asset references, and dead links are listed in a single panel instead of three different places.
- **Everything is clickable**: block references jump to and highlight the target block; external links open in your default browser; assets open in a SiYuan tab.
- **Direction is explicit**: outgoing entries show `This document → target`; backlinks and mentions show `source → This document`, so you always know who points to whom.
- **Find broken and orphaned notes**: references to deleted blocks are flagged as dead links; documents with no links at all are marked isolated, and one click lists every “island” in the notebook — handy for library cleanups.
- **Built for tidying**: search, group by document, exclude daily notes or self references, or restrict to the current notebook.
- **Readable at any size**: the UI font size is adjustable from 10 to 25 px for high-DPI screens or a wide dock.

### Is it for you?

Good fit if:

- You want to understand where a document sits in your knowledge base.
- You are tidying the library and need to find dead links and isolated documents.
- You follow references constantly and want a fuller view than the backlink pane.

Probably not a fit if:

- You only need bidirectional links — SiYuan's built-in backlink panel already covers that.
- You want a visual graph — this plugin is a list, not a graph.

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
- **Hover preview**: show the full context of the hovered item at the bottom of the panel; it can be turned off or dismissed manually.
- **Health overview**: counts for every section, plus an “isolated document” badge. Click the badge to list documents in the current notebook with no outgoing links, backlinks, or mentions; click a category chip to jump to and highlight its section.
- **Keyboard navigation**: `ArrowUp` / `ArrowDown` move between items; `Enter` opens.
- **Settings**: choose visible sections, grouping, auto-refresh, maximum items, UI font size (10–25 px), the hover-preview toggle, and default filters.
- **Click behavior**: block references open the target block; external links open in the default browser; assets open in a SiYuan tab.
- **Right-click menu**: copy the block reference, open in a new tab, split right/bottom, or open the source/target document.

## Usage

1. Enable the plugin.
2. Open the **Link Overview** dock from the right dock bar.
3. Open any document. The panel lists all of its links.
4. Click an item to jump to the target; hover to read the full context.

## FAQ

**Why don't I see mentions in block scope?**

Mentions are document-level (other documents mentioning this document's title); there is no block-level data, so they only appear in whole-document scope.

**What does “isolated document” mean?**

The current document has no outgoing links, no backlinks, and no mentions anywhere. Clicking the badge lists all such documents in the current notebook, which helps you connect or archive “island” notes.

**How are dead links detected?**

From `refs` entries whose target block no longer exists in the `blocks` table — the same rule the SiYuan kernel uses.

**Is my data safe?**

The plugin only reads indexes and Markdown through read-only APIs. It never writes notes, block attributes, or workspace configuration, and it makes no network requests (external links are opened by the system only when you click them).

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

Repository:

```text
https://github.com/Fly1018/siyuan-link-explorer
```

## License

MIT License.
