<script lang="ts">
    import { onDestroy } from "svelte";
    import { linkSettings, linkState, type LinkItem } from "@/state.svelte";
    import LinkItemRow from "./LinkItemRow.svelte";

    interface Props {
        labels: Record<string, string>;
        onRefresh: () => void;
        onOpen: (item: LinkItem) => void;
        onContextMenu: (event: MouseEvent, item: LinkItem) => void;
        onSettingsChange: (settings: typeof linkSettings) => void;
        onOpenSettings: () => void;
        onScopeChange: (scope: "doc" | "block") => void;
        onShowIsolated: () => void;
    }

    let { labels, onRefresh, onOpen, onContextMenu, onSettingsChange, onOpenSettings, onScopeChange, onShowIsolated }: Props = $props();

    let query = $state("");
    let hovered = $state<LinkItem | null>(null);
    let collapsed = $state<Record<string, boolean>>({});
    let activeSection = $state("");
    let activeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastContextKey = "";

    $effect(() => {
        const key = `${linkState.docID}|${linkState.scope}|${linkState.scopeBlockID}`;
        if (key !== lastContextKey) {
            lastContextKey = key;
            query = "";
            hovered = null;
            collapsed = {};
        }
    });

    function isDaily(path: string): boolean {
        const value = String(path || "").toLowerCase();
        return value.includes("daily note") || value.includes("日记") || value.includes("/daily/");
    }

    function matches(item: LinkItem): boolean {
        if (linkSettings.excludeSelf && item.self) return false;
        if (linkSettings.excludeDaily && (isDaily(item.sourcePath) || isDaily(item.targetPath))) return false;
        if (linkSettings.onlyNotebook &&
            item.sourceBox !== linkState.notebookID &&
            item.targetBox !== linkState.notebookID) {
            return false;
        }
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return `${item.title} ${item.context} ${item.meta} ${item.group}`.toLowerCase().includes(q);
    }

    const filteredOutgoing = $derived(linkState.outgoing.filter(matches));
    const filteredBacklinks = $derived(linkState.backlinks.filter(matches));
    const filteredMentions = $derived(linkState.mentions.filter(matches));
    const filteredExternal = $derived(linkState.external.filter(matches));
    const filteredAssets = $derived(linkState.assets.filter(matches));
    const filteredDead = $derived(linkState.dead.filter(matches));

    interface SectionView {
        key: string;
        title: string;
        flow: "out" | "in" | "dead";
        items: LinkItem[];
        empty: string;
        show?: boolean;
    }

    const sections = $derived<SectionView[]>(([
        { key: "outgoing", title: labels.outgoing, flow: "out" as const, items: filteredOutgoing, empty: labels.emptyOutgoing },
        { key: "backlinks", title: labels.backlinks, flow: "in" as const, items: filteredBacklinks, empty: labels.emptyBacklinks },
        { key: "mentions", title: labels.mentions, flow: "in" as const, items: filteredMentions, empty: labels.emptyMentions, show: linkSettings.showMentions && linkSettings.scope === "doc" },
        { key: "external", title: labels.externalLinks, flow: "out" as const, items: filteredExternal, empty: labels.emptyExternal, show: linkSettings.showExternal },
        { key: "assets", title: labels.assets, flow: "out" as const, items: filteredAssets, empty: labels.emptyAssets, show: linkSettings.showAssets },
        { key: "dead", title: labels.deadLinks, flow: "dead" as const, items: filteredDead, empty: labels.emptyDead, show: linkSettings.showDead },
    ] as SectionView[]).filter((section) => section.show !== false));

    const stats = $derived([
        { key: "outgoing", label: labels.outgoing, count: filteredOutgoing.length },
        { key: "backlinks", label: labels.backlinks, count: filteredBacklinks.length },
        { key: "mentions", label: labels.mentions, count: filteredMentions.length, show: linkSettings.showMentions && linkSettings.scope === "doc" },
        { key: "external", label: labels.externalLinks, count: filteredExternal.length, show: linkSettings.showExternal },
        { key: "assets", label: labels.assets, count: filteredAssets.length, show: linkSettings.showAssets },
        { key: "dead", label: labels.deadLinks, count: filteredDead.length, show: linkSettings.showDead },
    ].filter((item: any) => item.show !== false));

    const isolated = $derived(
        linkSettings.scope === "doc" &&
        Boolean(linkState.docID) &&
        linkState.outgoing.length === 0 &&
        linkState.backlinks.length === 0 &&
        linkState.mentions.length === 0,
    );

    function groupItems(items: LinkItem[]): Array<[string, LinkItem[]]> {
        if (!linkSettings.groupByDoc) return [["", items]];
        const map = new Map<string, LinkItem[]>();
        for (const item of items) {
            const key = item.group || labels.thisDoc;
            const list = map.get(key);
            if (list) list.push(item);
            else map.set(key, [item]);
        }
        return Array.from(map.entries());
    }

    function groupKey(section: string, group: string): string {
        return `${section}::${group}`;
    }

    function isCollapsed(key: string): boolean {
        return Boolean(collapsed[key]);
    }

    function toggleGroup(key: string) {
        collapsed[key] = !collapsed[key];
    }

    function toggleFilter(key: "excludeDaily" | "excludeSelf" | "onlyNotebook") {
        onSettingsChange({ ...linkSettings, [key]: !linkSettings[key] });
    }

    function jumpToSection(key: string) {
        activeSection = key;
        const target = document.querySelector<HTMLElement>(`.le-panel [data-le-section="${key}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (activeTimer) clearTimeout(activeTimer);
        activeTimer = setTimeout(() => {
            activeTimer = null;
            activeSection = "";
        }, 1400);
    }

    let previewTimer: ReturnType<typeof setTimeout> | null = null;
    let previewSuppressedUntil = 0;

    function clearPreviewTimer() {
        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
    }

    function onHover(item: LinkItem) {
        if (!linkSettings.hoverPreview || Date.now() < previewSuppressedUntil) return;
        clearPreviewTimer();
        hovered = item;
    }

    function onLeave(item: LinkItem) {
        if (hovered !== item) return;
        clearPreviewTimer();
        previewTimer = setTimeout(() => {
            hovered = null;
            previewTimer = null;
        }, 180);
    }

    function onPreviewEnter() {
        clearPreviewTimer();
    }

    function onPreviewLeave() {
        clearPreviewTimer();
        hovered = null;
    }

    function closePreview() {
        clearPreviewTimer();
        hovered = null;
        // The pointer is still over the panel, so ignore the immediate re-hover.
        previewSuppressedUntil = Date.now() + 350;
    }

    onDestroy(clearPreviewTimer);
</script>

<div class="le-panel" style={`--le-font-size: ${linkSettings.fontSize || 13}px`}>
    <header class="le-header">
        <div class="le-doc" title={linkState.docTitle}>{linkState.docTitle || labels.dockTitle}</div>
        <button type="button" class="le-iconbtn" title={labels.settings} aria-label={labels.settings} onclick={() => onOpenSettings()}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M8 1.6l.7 1.5 1.6-.3 1.4 1.4-.3 1.6 1.5.7v2l-1.5.7.3 1.6-1.4 1.4-1.6-.3-.7 1.5h-2l-.7-1.5-1.6.3-1.4-1.4.3-1.6L1.6 8V6l1.5-.7-.3-1.6 1.4-1.4 1.6.3.7-1.5h2Z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
            </svg>
        </button>
        <button type="button" class="le-iconbtn" title={labels.refresh} aria-label={labels.refresh} onclick={() => onRefresh()}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                <path d="M13 2.5V5h-2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
        </button>
    </header>

    <div class="le-scroll">
        <div class="le-scope">
            <button type="button" class="le-scope__btn" class:active={linkSettings.scope === "doc"} onclick={() => onScopeChange("doc")}>
                {labels.scopeDoc}
            </button>
            <button type="button" class="le-scope__btn" class:active={linkSettings.scope === "block"} onclick={() => onScopeChange("block")}>
                {labels.scopeBlock}
            </button>
            {#if linkSettings.scope === "block" && linkState.scopeBlockTitle}
                <span class="le-scope__title" title={linkState.scopeBlockTitle}>{linkState.scopeBlockTitle}</span>
            {/if}
        </div>

        {#if linkState.error}
            <div class="le-error">{linkState.error}</div>
        {/if}

        {#if !linkState.docID}
            <div class="le-empty le-empty--center">{labels.noDoc}</div>
        {:else if linkState.loading && linkState.outgoing.length === 0 && linkState.backlinks.length === 0}
            <div class="le-empty le-empty--center">{labels.loading}</div>
        {:else}
            <div class="le-health">
                {#each stats as stat (stat.key)}
                    <button
                        type="button"
                        class="le-stat"
                        class:le-stat--active={activeSection === stat.key}
                        title={`${labels.jumpTo} ${stat.label}`}
                        aria-label={`${labels.jumpTo} ${stat.label}`}
                        onclick={() => jumpToSection(stat.key)}
                    >
                        <b>{stat.count}</b>{stat.label}
                    </button>
                {/each}
                {#if isolated}
                    <button
                        type="button"
                        class="le-isolated"
                        title={labels.isolatedHint}
                        aria-label={labels.isolatedHint}
                        onclick={() => onShowIsolated()}
                    >{labels.isolated}</button>
                {/if}
            </div>

            <div class="le-tools">
                <input class="b3-text-field le-search" bind:value={query} placeholder={labels.searchPlaceholder} />
                <div class="le-filters">
                    <button type="button" class="le-chip" class:active={linkSettings.excludeDaily} onclick={() => toggleFilter("excludeDaily")}>
                        {labels.excludeDaily}
                    </button>
                    <button type="button" class="le-chip" class:active={linkSettings.excludeSelf} onclick={() => toggleFilter("excludeSelf")}>
                        {labels.excludeSelf}
                    </button>
                    <button type="button" class="le-chip" class:active={linkSettings.onlyNotebook} onclick={() => toggleFilter("onlyNotebook")}>
                        {labels.onlyNotebook}
                    </button>
                </div>
            </div>

            {#each sections as section (section.key)}
                <section class="le-section" class:le-section--active={activeSection === section.key} data-le-section={section.key}>
                    <div class="le-section__head">
                        <span>{section.title}</span>
                        <span class="le-count">{section.items.length}</span>
                        {#if section.flow === "out"}
                            <span class="le-flow-hint">{labels.outgoingFlow}</span>
                        {:else if section.flow === "in"}
                            <span class="le-flow-hint">{labels.backlinkFlow}</span>
                        {:else}
                            <span class="le-flow-hint">{labels.deadFlow}</span>
                        {/if}
                    </div>

                    {#if section.items.length === 0}
                        <div class="le-empty">{section.empty}</div>
                    {:else}
                        {#each groupItems(section.items) as [group, items] (group)}
                            {@const key = groupKey(section.key, group)}
                            <div class="le-group">
                                {#if group}
                                    <button type="button" class="le-group__head" onclick={() => toggleGroup(key)}>
                                        <span class="le-group__chevron">{isCollapsed(key) ? "▸" : "▾"}</span>
                                        <span class="le-group__name">{group}</span>
                                        <span class="le-group__count">{items.length}</span>
                                    </button>
                                {/if}
                                {#if !group || !isCollapsed(key)}
                                    <ul class="le-list">
                                        {#each items as item (item.kind + item.id + item.meta + item.group)}
                                            <li>
                                                <LinkItemRow
                                                    {item}
                                                    {labels}
                                                    flow={section.flow}
                                                    onOpen={() => onOpen(item)}
                                                    onHover={onHover}
                                                    onLeave={onLeave}
                                                    {onContextMenu}
                                                />
                                            </li>
                                        {/each}
                                    </ul>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                </section>
            {/each}
        {/if}
    </div>

    {#if hovered && linkSettings.hoverPreview}
        <div class="le-preview" role="tooltip" onmouseenter={onPreviewEnter} onmouseleave={onPreviewLeave}>
            <div class="le-preview__head">
                <div class="le-preview__title">{hovered.title}</div>
                <button
                    type="button"
                    class="le-preview__close"
                    title={labels.previewClose}
                    aria-label={labels.previewClose}
                    onclick={closePreview}
                >×</button>
            </div>
            <div class="le-preview__body">{hovered.fullContext || hovered.context || hovered.title}</div>
            {#if hovered.meta}
                <div class="le-preview__meta">{hovered.meta}</div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .le-panel {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        box-sizing: border-box;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        font-size: var(--le-font-size, 13px);
    }

    .le-header {
        flex: none;
        display: flex;
        align-items: center;
        gap: 0.308em;
        padding: 0.615em 0.769em;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-background);
    }

    .le-doc {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
    }

    .le-iconbtn {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2em;
        height: 2em;
        padding: 0;
        border: 0;
        border-radius: 0.385em;
        background: transparent;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
    }

    .le-iconbtn svg {
        width: 1.15em;
        height: 1.15em;
    }

    .le-iconbtn:hover,
    .le-iconbtn:focus-visible {
        background: var(--b3-theme-surface);
        color: var(--b3-theme-primary);
        outline: none;
    }

    .le-scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }

    .le-scope {
        display: flex;
        align-items: center;
        gap: 0.308em;
        flex-wrap: wrap;
        padding: 0.615em 0.769em 0.154em;
    }

    .le-scope__btn {
        padding: 0.154em 0.615em;
        border: 1px solid var(--b3-border-color);
        border-radius: 0.769em;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 0.846em;
        cursor: pointer;
    }

    .le-scope__btn.active {
        border-color: var(--b3-theme-primary);
        background: var(--b3-theme-primary);
        color: #fff;
    }

    .le-scope__title {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--b3-theme-on-surface);
        font-size: 0.846em;
        opacity: 0.8;
    }

    .le-error {
        margin: 0.615em 0.769em 0;
        padding: 0.538em 0.692em;
        border-radius: 0.385em;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-error);
        font-size: 0.923em;
        line-height: 1.5;
    }

    .le-health {
        display: flex;
        flex-wrap: wrap;
        gap: 0.308em;
        padding: 0.462em 0.769em 0.308em;
    }

    .le-stat,
    .le-isolated {
        padding: 0.077em 0.462em;
        border: 1px solid transparent;
        border-radius: 0.615em;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        font-size: 0.769em;
        line-height: 1.308em;
    }

    .le-stat {
        font-family: inherit;
        cursor: pointer;
    }

    .le-stat:hover,
    .le-stat:focus-visible {
        border-color: var(--b3-theme-primary);
        outline: none;
    }

    .le-stat--active {
        border-color: var(--b3-theme-primary);
        background: var(--b3-theme-primary);
        color: #fff;
    }

    .le-stat--active b {
        color: #fff;
    }

    .le-section--active {
        border-radius: 6px;
        box-shadow: inset 0 0 0 2px var(--b3-theme-primary);
        animation: le-flash 1.4s ease-out;
    }

    @keyframes le-flash {
        0% { background: color-mix(in srgb, var(--b3-theme-primary) 18%, transparent); }
        100% { background: transparent; }
    }

    .le-stat b {
        margin-right: 3px;
        color: var(--b3-theme-primary);
    }

    .le-isolated {
        font-family: inherit;
        background: #fef3c7;
        color: #92400e;
        cursor: pointer;
    }

    .le-isolated:hover,
    .le-isolated:focus-visible {
        border-color: #d97706;
        outline: none;
    }

    .le-tools {
        display: flex;
        flex-direction: column;
        gap: 0.462em;
        padding: 0.308em 0.769em 0.615em;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .le-search {
        width: 100%;
        height: auto;
        min-height: 2.2em;
        box-sizing: border-box;
        padding: 0.25em 0.5em;
        font-size: 1em;
    }

    .le-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.308em;
    }

    .le-chip {
        padding: 0.077em 0.538em;
        border: 1px solid var(--b3-border-color);
        border-radius: 0.692em;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 0.769em;
        line-height: 1.308em;
        cursor: pointer;
    }

    .le-chip.active {
        border-color: var(--b3-theme-primary);
        background: var(--b3-theme-primary);
        color: #fff;
    }

    .le-section {
        padding: 0.615em 0.615em 0.308em;
    }

    .le-section + .le-section {
        border-top: 1px solid var(--b3-border-color);
    }

    .le-section__head {
        display: flex;
        align-items: center;
        gap: 0.462em;
        padding: 0.154em 0.308em 0.462em;
        color: var(--b3-theme-on-surface);
        font-size: 0.923em;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .le-count {
        min-width: 1.385em;
        padding: 0 0.385em;
        border-radius: 0.692em;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        font-size: 0.846em;
        font-weight: 400;
        text-align: center;
    }

    .le-flow-hint {
        margin-left: auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--b3-theme-on-surface);
        font-size: 0.769em;
        font-weight: 400;
        opacity: 0.75;
    }

    .le-group__head {
        display: flex;
        align-items: center;
        gap: 0.385em;
        width: 100%;
        padding: 0.231em 0.308em;
        border: 0;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 0.846em;
        text-align: left;
        cursor: pointer;
    }

    .le-group__head:hover {
        background: var(--b3-theme-surface);
    }

    .le-group__chevron {
        width: 0.769em;
        color: var(--b3-theme-on-surface);
    }

    .le-group__name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .le-group__count {
        flex: none;
        opacity: 0.7;
    }

    .le-list {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .le-empty {
        padding: 0.462em 0.462em 0.769em;
        color: var(--b3-theme-on-surface);
        font-size: 0.923em;
        opacity: 0.8;
    }

    .le-empty--center {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 9.23em;
        padding: 1.538em;
        text-align: center;
    }

    .le-preview {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 20;
        max-height: 13.08em;
        overflow: auto;
        padding: 0.615em 0.769em;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.12);
        /* Overlay without changing layout; avoids the hover feedback loop. */
        pointer-events: auto;
    }

    .le-preview__head {
        display: flex;
        align-items: flex-start;
        gap: 0.462em;
    }

    .le-preview__title {
        flex: 1;
        min-width: 0;
        margin-bottom: 0.308em;
        font-size: 0.923em;
        font-weight: 600;
    }

    .le-preview__close {
        flex: none;
        width: 1.4em;
        height: 1.4em;
        padding: 0;
        border: 0;
        border-radius: 0.3em;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 1em;
        line-height: 1;
        cursor: pointer;
        opacity: 0.7;
    }

    .le-preview__close:hover,
    .le-preview__close:focus-visible {
        background: var(--b3-theme-background);
        opacity: 1;
        outline: none;
    }

    .le-preview__body {
        color: var(--b3-theme-on-surface);
        font-size: 0.923em;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .le-preview__meta {
        margin-top: 0.308em;
        color: var(--b3-theme-on-surface);
        font-size: 0.769em;
        opacity: 0.7;
        word-break: break-all;
    }
</style>
