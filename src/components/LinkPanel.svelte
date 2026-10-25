<script lang="ts">
    import { onDestroy } from "svelte";
    import {
        ISOLATED_MAX,
        linkSettings,
        linkState,
        type HealthDoc,
        type IsolatedDoc,
        type LinkItem,
    } from "@/state.svelte";
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
        onCloseIsolated: () => void;
        onOpenIsolated: (doc: IsolatedDoc) => void;
        onShowHealth: () => void;
        onCloseHealth: () => void;
        onOpenHealthDoc: (doc: HealthDoc) => void;
        onCopyReport: (text: string) => void;
    }

    let {
        labels, onRefresh, onOpen, onContextMenu, onSettingsChange, onOpenSettings,
        onScopeChange, onShowIsolated, onCloseIsolated, onOpenIsolated,
        onShowHealth, onCloseHealth, onOpenHealthDoc, onCopyReport,
    }: Props = $props();

    let query = $state("");
    let hovered = $state<LinkItem | null>(null);
    let collapsed = $state<Record<string, boolean>>({});
    let activeCategory = $state("");
    let lastContextKey = "";
    let searchEl: HTMLInputElement | undefined = $state();
    let scrollEl: HTMLElement | undefined = $state();

    $effect(() => {
        const key = `${linkState.docID}|${linkState.scope}|${linkState.scopeBlockID}`;
        if (key !== lastContextKey) {
            lastContextKey = key;
            query = "";
            hovered = null;
            collapsed = {};
            activeCategory = "";
        }
    });

    const isolatedTitle = $derived(
        `${labels.isolated}${linkState.isolatedDocs.length ? ` (${linkState.isolatedDocs.length})` : ""}`,
    );
    const headerTitle = $derived(
        linkState.healthActive
            ? labels.health
            : linkState.isolatedActive
                ? isolatedTitle
                : (linkState.docTitle || labels.dockTitle),
    );

    $effect(() => {
        if (linkState.isolatedActive || linkState.healthActive) hovered = null;
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
        total: number;
        empty: string;
        show?: boolean;
    }

    const sections = $derived<SectionView[]>(([
        { key: "outgoing", title: labels.outgoing, flow: "out" as const, items: filteredOutgoing, total: linkState.outgoing.length, empty: labels.emptyOutgoing },
        { key: "backlinks", title: labels.backlinks, flow: "in" as const, items: filteredBacklinks, total: linkState.backlinks.length, empty: labels.emptyBacklinks },
        { key: "mentions", title: labels.mentions, flow: "in" as const, items: filteredMentions, total: linkState.mentions.length, empty: labels.emptyMentions, show: linkSettings.showMentions && linkSettings.scope === "doc" },
        { key: "external", title: labels.externalLinks, flow: "out" as const, items: filteredExternal, total: linkState.external.length, empty: labels.emptyExternal, show: linkSettings.showExternal },
        { key: "assets", title: labels.assets, flow: "out" as const, items: filteredAssets, total: linkState.assets.length, empty: labels.emptyAssets, show: linkSettings.showAssets },
        { key: "dead", title: labels.deadLinks, flow: "dead" as const, items: filteredDead, total: linkState.dead.length, empty: labels.emptyDead, show: linkSettings.showDead },
    ] as SectionView[])
        .filter((section) => section.show !== false)
        // Keep an explicitly selected category visible even when it is empty.
        .filter((section) => !linkSettings.hideEmptySections || section.total > 0 || section.key === activeCategory));

    // A stat chip switches the list to one category; clicking it again shows all.
    const visibleSections = $derived.by(() => {
        if (!activeCategory) return sections;
        const picked = sections.filter((section) => section.key === activeCategory);
        return picked.length ? picked : sections;
    });

    const allEmpty = $derived(
        Boolean(linkState.docID) &&
        !linkState.loading &&
        linkState.outgoing.length + linkState.backlinks.length + linkState.mentions.length +
        linkState.external.length + linkState.assets.length + linkState.dead.length === 0,
    );

    const missingAssetCount = $derived(linkState.assets.filter((item) => item.assetMissing).length);

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

    function sortItems(items: LinkItem[]): LinkItem[] {
        const mode = linkSettings.sortMode;
        if (mode === "default") return items;
        const list = [...items];
        if (mode === "title") {
            list.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN") || a.key.localeCompare(b.key));
        } else {
            list.sort((a, b) => (b.updated || "").localeCompare(a.updated || "") ||
                a.title.localeCompare(b.title, "zh-Hans-CN"));
        }
        return list;
    }

    function groupItems(section: SectionView): Array<[string, LinkItem[]]> {
        // Resources are always grouped by file type; the document grouping
        // setting is meant for references and backlinks.
        if (section.key !== "assets" && !linkSettings.groupByDoc) return [["", sortItems(section.items)]];
        const map = new Map<string, LinkItem[]>();
        for (const item of section.items) {
            const key = item.group || labels.thisDoc;
            const list = map.get(key);
            if (list) list.push(item);
            else map.set(key, [item]);
        }
        return Array.from(map.entries()).map(([group, items]) => [group, sortItems(items)]);
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

    function selectCategory(key: string) {
        activeCategory = activeCategory === key ? "" : key;
        hovered = null;
    }

    const allGroupKeys = $derived(visibleSections.flatMap((section) =>
        groupItems(section)
            .map(([group]) => (group ? groupKey(section.key, group) : ""))
            .filter(Boolean),
    ));
    const anyCollapsed = $derived(allGroupKeys.some((key) => collapsed[key]));

    function toggleAllGroups() {
        if (anyCollapsed) {
            collapsed = {};
            return;
        }
        const next: Record<string, boolean> = {};
        for (const key of allGroupKeys) next[key] = true;
        collapsed = next;
    }

    function onPanelKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && (query || activeCategory)) {
            event.preventDefault();
            query = "";
            activeCategory = "";
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select")) return;
        if (event.key === "/") {
            event.preventDefault();
            searchEl?.focus();
            return;
        }
        if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            scrollEl?.scrollTo({ top: event.key === "Home" ? 0 : scrollEl.scrollHeight });
        }
    }

    function escapeMd(text: string): string {
        return String(text || "").replace(/[[\]]/g, "\\$&");
    }

    function buildReport(): string {
        const lines = [`# ${labels.dockTitle} · ${linkState.docTitle}`];
        for (const section of visibleSections) {
            lines.push("", `## ${section.title} (${section.items.length})`);
            if (!section.items.length) {
                lines.push(`- ${section.total === 0 ? section.empty : labels.noMatch}`);
                continue;
            }
            for (const [group, items] of groupItems(section)) {
                if (group) lines.push("", `### ${group}`);
                for (const item of items) {
                    const label = escapeMd(item.title);
                    const meta: string[] = [];
                    if (item.count && item.count > 1) meta.push(`×${item.count}`);
                    if (item.assetMissing) meta.push(`(${labels.assetMissing})`);
                    if (item.context && item.context !== item.title && item.context !== (item.url || "")) {
                        meta.push(`— ${item.context}`);
                    }
                    const suffix = meta.length ? ` ${meta.join(" ")}` : "";
                    if (item.kind === "dead") {
                        lines.push(`- ${labels.deadTarget}${suffix}`);
                    } else if (item.kind === "external" || item.kind === "asset") {
                        lines.push(`- [${label}](${item.url || item.id})${suffix}`);
                    } else {
                        lines.push(`- [${label}](siyuan://blocks/${item.id})${suffix}`);
                    }
                }
            }
        }
        return lines.join("\n");
    }

    function copyReport() {
        onCopyReport(buildReport());
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

    function hidePreview() {
        clearPreviewTimer();
        hovered = null;
    }

    const previewText = $derived.by(() => {
        const item = hovered;
        if (!item) return "";
        return [item.fullContext, item.context].find((text) => text && text !== item.title) || "";
    });

    onDestroy(clearPreviewTimer);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- panel-scoped shortcuts only fire while this region has focus -->
<div class="le-panel" role="region" aria-label={labels.dockTitle} style={`--le-font-size: ${linkSettings.fontSize || 13}px`} onkeydown={onPanelKeydown}>
    <header class="le-header">
        <div class="le-doc" title={headerTitle}>{headerTitle}</div>
        {#if !linkState.isolatedActive && !linkState.healthActive}
            <button type="button" class="le-iconbtn" title={labels.copyReport} aria-label={labels.copyReport} onclick={copyReport}>
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                    <rect x="5.6" y="2.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
                    <path d="M10.4 13.5H3.7A1.2 1.2 0 0 1 2.5 12.3V5.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                </svg>
            </button>
        {/if}
        <button type="button" class="le-iconbtn" title={labels.settings} aria-label={labels.settings} onclick={() => onOpenSettings()}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M6.94 1.69 L9.06 1.69 L9.23 3.26 L10.49 3.78 L11.72 2.79 L13.21 4.28 L12.22 5.51 L12.74 6.77 L14.31 6.94 L14.31 9.06 L12.74 9.23 L12.22 10.49 L13.21 11.72 L11.72 13.21 L10.49 12.22 L9.23 12.74 L9.06 14.31 L6.94 14.31 L6.77 12.74 L5.51 12.22 L4.28 13.21 L2.79 11.72 L3.78 10.49 L3.26 9.23 L1.69 9.06 L1.69 6.94 L3.26 6.77 L3.78 5.51 L2.79 4.28 L4.28 2.79 L5.51 3.78 L6.77 3.26 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                <circle cx="8" cy="8" r="2.05" fill="none" stroke="currentColor" stroke-width="1.4" />
            </svg>
        </button>
        <button type="button" class="le-iconbtn" title={labels.refresh} aria-label={labels.refresh} onclick={() => onRefresh()}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                <path d="M13 2.5V5h-2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
        </button>
    </header>

    <div class="le-scroll" onscroll={hidePreview} bind:this={scrollEl}>
        {#if linkState.healthActive}
            <div class="le-isolated-view">
                <button type="button" class="le-back" onclick={() => onCloseHealth()}>
                    <span class="le-back__arrow">←</span>{labels.backToLinks}
                </button>
                {#if linkState.healthLoading}
                    <div class="le-isolated__hint">{labels.loading}</div>
                {:else if linkState.healthError}
                    <div class="le-error">{linkState.healthError}</div>
                {:else if linkState.healthData}
                    <div class="le-isolated__hint">{labels.healthHint}</div>
                    <div class="le-health-stats">
                        <div class="le-health-stat">
                            <b>{linkState.healthData.docs}</b><span>{labels.healthDocs}</span>
                        </div>
                        <div class="le-health-stat">
                            <b>{linkState.healthData.deadRefs}</b><span>{labels.healthDeadRefs}</span>
                        </div>
                        <div class="le-health-stat">
                            <b>{linkState.healthData.missingAssets.length}</b><span>{labels.healthMissing}</span>
                        </div>
                    </div>
                    {#if linkState.healthData.missingAssets.length}
                        <section class="le-health-block">
                            <div class="le-health-block__head">
                                {labels.healthMissing}
                                <span class="le-count">{linkState.healthData.missingAssets.length}</span>
                            </div>
                            <ul class="le-health-list">
                                {#each linkState.healthData.missingAssets.slice(0, 8) as asset (asset.path)}
                                    <li class="le-health-item">
                                        <span class="le-health-item__title">{asset.name || asset.path}</span>
                                        <span class="le-health-item__path">{asset.path}</span>
                                    </li>
                                {/each}
                            </ul>
                        </section>
                    {/if}
                    {#each [
                        { key: "deadDocs", title: labels.healthDeadDocs, docs: linkState.healthData.deadDocs },
                        { key: "topOutgoing", title: labels.healthTopOutgoing, docs: linkState.healthData.topOutgoing },
                        { key: "topIncoming", title: labels.healthTopIncoming, docs: linkState.healthData.topIncoming },
                    ] as block (block.key)}
                        {#if block.docs.length}
                            <section class="le-health-block">
                                <div class="le-health-block__head">{block.title}</div>
                                <ul class="le-health-list">
                                    {#each block.docs as doc (doc.id)}
                                        <li>
                                            <button type="button" class="le-orphan" onclick={() => onOpenHealthDoc(doc)}>
                                                <span class="le-orphan__title">{doc.title}</span>
                                                <span class="le-orphan__path">{doc.hpath} · {doc.count}</span>
                                            </button>
                                        </li>
                                    {/each}
                                </ul>
                            </section>
                        {/if}
                    {/each}
                    {#if !linkState.healthData.missingAssets.length && !linkState.healthData.deadDocs.length && !linkState.healthData.topOutgoing.length && !linkState.healthData.topIncoming.length}
                        <div class="le-empty le-empty--center">{labels.healthEmpty}</div>
                    {/if}
                {/if}
            </div>
        {:else if linkState.isolatedActive}
            <div class="le-isolated-view">
                <button type="button" class="le-back" onclick={() => onCloseIsolated()}>
                    <span class="le-back__arrow">←</span>{labels.backToLinks}
                </button>
                <div class="le-isolated__hint">
                    {#if linkState.isolatedLoading}
                        {labels.isolatedScanning}
                    {:else if linkState.isolatedError}
                        {linkState.isolatedError}
                    {:else}
                        {labels.isolatedDocsHint}
                    {/if}
                </div>
                {#if linkState.isolatedDocs.length}
                    <ul class="le-isolated__list">
                        {#each linkState.isolatedDocs as doc (doc.id)}
                            <li>
                                <button type="button" class="le-orphan" onclick={() => onOpenIsolated(doc)}>
                                    <span class="le-orphan__title">{doc.title}</span>
                                    <span class="le-orphan__path">{doc.hpath}</span>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {:else if !linkState.isolatedLoading && !linkState.isolatedError}
                    <div class="le-empty le-empty--center">{labels.isolatedEmpty}</div>
                {/if}
                {#if linkState.isolatedHasMore}
                    <div class="le-isolated__hint">
                        {labels.isolatedLimit.replace("{count}", String(ISOLATED_MAX))}
                    </div>
                {/if}
            </div>
        {:else}
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
                        class:le-stat--active={activeCategory === stat.key}
                        aria-pressed={activeCategory === stat.key}
                        title={activeCategory === stat.key ? labels.showAll : `${labels.showOnly} ${stat.label}`}
                        aria-label={`${labels.showOnly} ${stat.label}`}
                        onclick={() => selectCategory(stat.key)}
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
                {#if linkState.docID}
                    <button
                        type="button"
                        class="le-health-badge"
                        title={labels.healthHint}
                        aria-label={labels.healthHint}
                        onclick={() => onShowHealth()}
                    >{labels.health}</button>
                {/if}
            </div>

            <div class="le-tools">
                <input class="b3-text-field le-search" bind:this={searchEl} bind:value={query} placeholder={labels.searchPlaceholder} />
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
                    {#if allGroupKeys.length}
                        <button type="button" class="le-chip le-chip--group" onclick={toggleAllGroups}>
                            {anyCollapsed ? labels.expandAll : labels.collapseAll}
                        </button>
                    {/if}
                </div>
            </div>

            {#if allEmpty}
                <div class="le-empty le-empty--center">{labels.noLinks}</div>
            {:else}
            {#each visibleSections as section (section.key)}
                <section class="le-section">
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

                    {#if section.key === "assets" && missingAssetCount > 0}
                        <div class="le-asset-warning">
                            {labels.missingAssetsNote.replace("{count}", String(missingAssetCount))}
                        </div>
                    {/if}

                    {#if section.items.length === 0}
                        <div class="le-empty">{section.total === 0 ? section.empty : labels.noMatch}</div>
                    {:else}
                        {#each groupItems(section) as [group, items] (group)}
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
                                        {#each items as item (item.key)}
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
        {/if}
        {/if}
    </div>

    {#if hovered && !linkState.isolatedActive && !linkState.healthActive && linkSettings.hoverPreview}
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
            {#if previewText}
                <div class="le-preview__body">{previewText}</div>
            {/if}
            {#if hovered.meta && hovered.meta !== hovered.title}
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

    .le-stat b {
        margin-right: 3px;
        color: var(--b3-theme-primary);
    }

    .le-isolated {
        font-family: inherit;
        background: color-mix(in srgb, #f59e0b 20%, var(--b3-theme-surface));
        color: color-mix(in srgb, #b45309 55%, var(--b3-theme-on-surface));
        cursor: pointer;
    }

    .le-isolated:hover,
    .le-isolated:focus-visible {
        border-color: color-mix(in srgb, #d97706 70%, var(--b3-border-color));
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

    .le-isolated-view {
        display: flex;
        flex-direction: column;
        gap: 0.462em;
        padding: 0.615em 0.769em;
    }

    .le-back {
        align-self: flex-start;
        padding: 0.154em 0.615em;
        border: 1px solid var(--b3-border-color);
        border-radius: 0.615em;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-family: inherit;
        font-size: 0.846em;
        cursor: pointer;
    }

    .le-back:hover,
    .le-back:focus-visible {
        background: var(--b3-theme-surface);
        color: var(--b3-theme-primary);
        outline: none;
    }

    .le-back__arrow {
        margin-right: 0.231em;
    }

    .le-isolated__hint {
        color: var(--b3-theme-on-surface);
        font-size: 0.846em;
        line-height: 1.5;
        opacity: 0.75;
    }

    .le-isolated__list {
        display: flex;
        flex-direction: column;
        gap: 0.154em;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .le-orphan {
        display: flex;
        flex-direction: column;
        gap: 0.154em;
        width: 100%;
        padding: 0.462em 0.615em;
        border: 0;
        border-radius: 0.385em;
        background: transparent;
        color: inherit;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
    }

    .le-orphan:hover,
    .le-orphan:focus-visible {
        background: var(--b3-theme-surface);
        outline: none;
    }

    .le-orphan__title {
        overflow: hidden;
        font-size: 1em;
        font-weight: 500;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .le-orphan__path {
        overflow: hidden;
        font-size: 0.846em;
        opacity: 0.55;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .le-health-badge {
        padding: 0.077em 0.462em;
        border: 1px solid transparent;
        border-radius: 0.615em;
        background: color-mix(in srgb, var(--b3-theme-primary) 12%, var(--b3-theme-surface));
        color: color-mix(in srgb, var(--b3-theme-primary) 70%, var(--b3-theme-on-surface));
        font-family: inherit;
        font-size: 0.769em;
        line-height: 1.308em;
        cursor: pointer;
    }

    .le-health-badge:hover,
    .le-health-badge:focus-visible {
        border-color: var(--b3-theme-primary);
        outline: none;
    }

    .le-asset-warning {
        margin: 0 0.308em 0.462em;
        padding: 0.231em 0.462em;
        border-radius: 0.385em;
        background: color-mix(in srgb, #ef4444 12%, var(--b3-theme-surface));
        color: color-mix(in srgb, #b91c1c 65%, var(--b3-theme-on-surface));
        font-size: 0.846em;
        line-height: 1.5;
    }

    .le-chip--group {
        margin-left: auto;
        border-style: dashed;
    }

    .le-health-stats {
        display: flex;
        gap: 0.462em;
    }

    .le-health-stat {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 0.154em;
        padding: 0.462em 0.615em;
        border-radius: 0.462em;
        background: var(--b3-theme-surface);
    }

    .le-health-stat b {
        color: var(--b3-theme-primary);
        font-size: 1.231em;
    }

    .le-health-stat span {
        color: var(--b3-theme-on-surface);
        font-size: 0.769em;
        opacity: 0.8;
    }

    .le-health-block {
        display: flex;
        flex-direction: column;
        gap: 0.231em;
        padding-top: 0.462em;
        border-top: 1px solid var(--b3-border-color);
    }

    .le-health-block__head {
        display: flex;
        align-items: center;
        gap: 0.462em;
        color: var(--b3-theme-on-surface);
        font-size: 0.923em;
        font-weight: 600;
    }

    .le-health-list {
        display: flex;
        flex-direction: column;
        gap: 0.154em;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .le-health-item {
        display: flex;
        flex-direction: column;
        gap: 0.077em;
        padding: 0.308em 0.462em;
        border-radius: 0.385em;
        background: color-mix(in srgb, #ef4444 8%, var(--b3-theme-surface));
    }

    .le-health-item__title {
        overflow: hidden;
        font-size: 0.923em;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .le-health-item__path {
        overflow: hidden;
        font-size: 0.769em;
        opacity: 0.6;
        white-space: nowrap;
        text-overflow: ellipsis;
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
