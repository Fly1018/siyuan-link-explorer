# Changelog

All notable changes to the **Link Panorama** plugin will be documented in this file.

## v0.3.0 (2026-10-21)

- Renames the display name to 链接全景 / Link Panorama (the plugin id `siyuan-link-explorer` stays the same).
- Rewrites the user-facing README (Chinese and English) around why and how to use the panel, with a FAQ.
- Adds a configurable UI font size (10–25 px); the whole panel scales with it.
- Adds a hover-preview toggle and a manual close button; moving the pointer into the preview keeps it open, and closing it no longer re-opens immediately.
- Makes the “isolated document” badge clickable: it lists documents in the current notebook with no outgoing links, backlinks, or mentions, and each entry opens the document.
- Fixes: mentions stat now follows the search filter; the isolated badge no longer shows in block scope; Enter reliably opens the focused item; dead references no longer also appear under outgoing links; the hover preview no longer causes scroll jitter (it is now an overlay).

## v0.2.x (2026-10-19)

- Initial Vite + Svelte rebuild: outgoing links, backlinks, mentions, external links, asset references, dead links; search, grouping, filters, scope switching, keyboard navigation, and settings.
