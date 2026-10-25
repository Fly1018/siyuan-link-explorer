<script lang="ts">
    import type { LinkItem } from "@/state.svelte";

    interface Props {
        item: LinkItem;
        labels: Record<string, string>;
        flow: "out" | "in" | "dead";
        onOpen: (item: LinkItem) => void;
        onHover: (item: LinkItem) => void;
        onLeave: (item: LinkItem) => void;
        onContextMenu: (event: MouseEvent, item: LinkItem) => void;
    }

    let { item, labels, flow, onOpen, onHover, onLeave, onContextMenu }: Props = $props();

    const ASSET_LABEL_KEYS: Record<string, string> = {
        image: "assetImage",
        video: "assetVideo",
        audio: "assetAudio",
        pdf: "assetPdf",
        document: "assetDocument",
        archive: "assetArchive",
        other: "assetOther",
    };

    const from = $derived(
        flow === "out"
            ? labels.thisDoc
            : flow === "dead"
                ? (item.group || labels.thisDoc)
                : item.title,
    );
    const to = $derived(
        flow === "out"
            ? item.title
            : flow === "dead"
                ? labels.deadTarget
                : labels.thisDoc,
    );
    const kindLabel = $derived(
        item.kind === "embed"
            ? labels.embed
            : item.kind === "mention"
                ? labels.mention
                : item.kind === "external"
                    ? labels.external
                : item.kind === "asset"
                    ? (labels[ASSET_LABEL_KEYS[item.assetKind || "other"]] || labels.asset)
                    : item.kind === "dead"
                            ? labels.deadTarget
                            : labels.reference,
    );
    // A reference whose block contains nothing but the link repeats the direction line.
    const showContext = $derived(
        Boolean(item.context) &&
        item.context !== from &&
        item.context !== to &&
        item.context !== item.title,
    );
    // Backlink anchors can repeat the source line for self references.
    const showMeta = $derived(
        Boolean(item.meta) &&
        item.meta !== from &&
        item.meta !== to &&
        item.meta !== item.title,
    );

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            event.preventDefault();
            onOpen(item);
            return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const panel = (event.currentTarget as HTMLElement).closest(".le-panel") || document;
        const items = Array.from(panel.querySelectorAll<HTMLElement>(".le-item"));
        const index = items.indexOf(event.currentTarget as HTMLElement);
        const next = items[index + (event.key === "ArrowDown" ? 1 : -1)];
        next?.focus();
    }
</script>

<button
    type="button"
    class="le-item"
    class:le-item--dead={flow === "dead"}
    title={item.fullContext || item.context || item.title}
    onclick={() => onOpen(item)}
    onkeydown={onKeyDown}
    onmouseenter={() => onHover(item)}
    onmouseleave={() => onLeave(item)}
    onfocus={() => onHover(item)}
    onblur={() => onLeave(item)}
    oncontextmenu={(event) => {
        event.preventDefault();
        onContextMenu(event, item);
    }}
>
    <span class="le-item__direction" title={`${from} → ${to}`}>
        <span class="le-flow le-flow--self">{from}</span>
        <span class="le-arrow" class:le-arrow--in={flow === "in"} class:le-arrow--dead={flow === "dead"}>→</span>
        <span class="le-flow le-flow--target">{to}</span>
    </span>
    {#if showContext}
        <span class="le-item__context">{item.context}</span>
    {/if}
    <span class="le-item__footer">
        <span class="le-item__kind">{kindLabel}</span>
        {#if item.count && item.count > 1}
            <span class="le-item__count">×{item.count}</span>
        {/if}
        {#if item.assetMissing}
            <span class="le-item__missing">{labels.assetMissing}</span>
        {/if}
        {#if showMeta}
            <span class="le-item__meta">{item.meta}</span>
        {/if}
    </span>
</button>

<style>
    .le-item {
        display: flex;
        flex-direction: column;
        gap: 0.231em;
        width: 100%;
        box-sizing: border-box;
        margin: 0 0 0.308em;
        padding: 0.538em 0.615em;
        border: 1px solid transparent;
        border-radius: 0.462em;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
    }

    .le-item:hover,
    .le-item:focus-visible {
        border-color: var(--b3-border-color);
        background: var(--b3-theme-surface);
        outline: none;
    }

    .le-item--dead .le-item__direction {
        opacity: 0.9;
    }

    .le-item__direction {
        display: flex;
        align-items: baseline;
        gap: 0.385em;
        min-width: 0;
        overflow: hidden;
        font-weight: 600;
        line-height: 1.4;
    }

    .le-flow {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .le-flow--self {
        flex: none;
        max-width: 45%;
        color: var(--b3-theme-on-surface);
        font-weight: 400;
    }

    .le-flow--target {
        min-width: 0;
        color: var(--b3-theme-on-background);
    }

    .le-arrow {
        flex: none;
        color: var(--b3-theme-primary);
        font-weight: 700;
    }

    .le-arrow--in {
        color: #16a34a;
    }

    .le-arrow--dead {
        color: #dc2626;
    }

    .le-item__context {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        color: var(--b3-theme-on-surface);
        font-size: 0.923em;
        line-height: 1.5;
        word-break: break-word;
    }

    .le-item__footer {
        display: flex;
        align-items: center;
        gap: 0.462em;
        min-width: 0;
    }

    .le-item__kind {
        flex: none;
        padding: 0 0.385em;
        border-radius: 0.308em;
        background: var(--b3-theme-surface-lighter);
        color: var(--b3-theme-on-surface);
        font-size: 0.769em;
        line-height: 1.231em;
    }

    .le-item--dead .le-item__kind {
        background: color-mix(in srgb, #ef4444 18%, var(--b3-theme-surface));
        color: color-mix(in srgb, #b91c1c 55%, var(--b3-theme-on-surface));
    }

    .le-item__count {
        flex: none;
        padding: 0 0.385em;
        border-radius: 0.308em;
        background: var(--b3-theme-surface-lighter);
        color: var(--b3-theme-on-surface);
        font-size: 0.769em;
        line-height: 1.231em;
    }

    .le-item__missing {
        flex: none;
        padding: 0 0.385em;
        border-radius: 0.308em;
        background: color-mix(in srgb, #ef4444 18%, var(--b3-theme-surface));
        color: color-mix(in srgb, #b91c1c 55%, var(--b3-theme-on-surface));
        font-size: 0.769em;
        line-height: 1.231em;
    }

    .le-item__meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--b3-theme-on-surface);
        font-size: 0.846em;
        opacity: 0.8;
    }
</style>
