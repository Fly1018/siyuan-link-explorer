<script lang="ts">
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
    }

    let { labels, onRefresh, onOpen, onContextMenu, onSettingsChange, onOpenSettings, onScopeChange }: Props = $props();

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
        { key: "mentions", label: labels.mentions, count: linkState.mentions.length, show: linkSettings.showMentions && linkSettings.scope === "doc" },
        { key: "external", label: labels.externalLinks, count: filteredExternal.length, show: linkSettings.showExternal },
        { key: "assets", label: labels.assets, count: filteredAssets.length, show: linkSettings.showAssets },
        { key: "dead", label: labels.deadLinks, count: filteredDead.length, show: linkSettings.showDead },
    ].filter((item: any) => item.show !== false));

    const isolated = $derived(
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

    function onHover(item: LinkItem) {
        hovered = item;
    }

    function onLeave(item: LinkItem) {
        if (hovered === item) hovered = null;
    }
</script>

<div class="le-panel">
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
                    <span class="le-isolated">{labels.isolated}</span>
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

    {#if hovered}
        <div class="le-preview">
            <div class="le-preview__title">{hovered.title}</div>
            <div class="le-preview__body">{hovered.fullContext || hovered.context || hovered.title}</div>
            {#if hovered.meta}
                <div class="le-preview__meta">{hovered.meta}</div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .le-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        box-sizing: border-box;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        font-size: 13px;
    }

    .le-header {
        flex: none;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 10px;
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
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
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
        gap: 4px;
        flex-wrap: wrap;
        padding: 8px 10px 2px;
    }

    .le-scope__btn {
        padding: 2px 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: 10px;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 11px;
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
        font-size: 11px;
        opacity: 0.8;
    }

    .le-error {
        margin: 8px 10px 0;
        padding: 7px 9px;
        border-radius: 5px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-error);
        font-size: 12px;
        line-height: 1.5;
    }

    .le-health {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 6px 10px 4px;
    }

    .le-stat,
    .le-isolated {
        padding: 1px 6px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        font-size: 10px;
        line-height: 17px;
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
        background: #fef3c7;
        color: #92400e;
    }

    .le-tools {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px 10px 8px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .le-search {
        width: 100%;
        box-sizing: border-box;
    }

    .le-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .le-chip {
        padding: 1px 7px;
        border: 1px solid var(--b3-border-color);
        border-radius: 9px;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 10px;
        line-height: 17px;
        cursor: pointer;
    }

    .le-chip.active {
        border-color: var(--b3-theme-primary);
        background: var(--b3-theme-primary);
        color: #fff;
    }

    .le-section {
        padding: 8px 8px 4px;
    }

    .le-section + .le-section {
        border-top: 1px solid var(--b3-border-color);
    }

    .le-section__head {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 4px 6px;
        color: var(--b3-theme-on-surface);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .le-count {
        min-width: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        font-size: 11px;
        font-weight: 400;
        text-align: center;
    }

    .le-flow-hint {
        margin-left: auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--b3-theme-on-surface);
        font-size: 10px;
        font-weight: 400;
        opacity: 0.75;
    }

    .le-group__head {
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
        padding: 3px 4px;
        border: 0;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 11px;
        text-align: left;
        cursor: pointer;
    }

    .le-group__head:hover {
        background: var(--b3-theme-surface);
    }

    .le-group__chevron {
        width: 10px;
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
        padding: 6px 6px 10px;
        color: var(--b3-theme-on-surface);
        font-size: 12px;
        opacity: 0.8;
    }

    .le-empty--center {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 120px;
        padding: 20px;
        text-align: center;
    }

    .le-preview {
        flex: none;
        max-height: 170px;
        overflow: auto;
        padding: 8px 10px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
    }

    .le-preview__title {
        margin-bottom: 4px;
        font-size: 12px;
        font-weight: 600;
    }

    .le-preview__body {
        color: var(--b3-theme-on-surface);
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .le-preview__meta {
        margin-top: 4px;
        color: var(--b3-theme-on-surface);
        font-size: 10px;
        opacity: 0.7;
        word-break: break-all;
    }
</style>
