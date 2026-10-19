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
                        ? labels.asset
                        : item.kind === "dead"
                            ? labels.deadTarget
                            : labels.reference,
    );

    function onKeyDown(event: KeyboardEvent) {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const items = Array.from(document.querySelectorAll<HTMLElement>(".le-panel .le-item"));
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
    {#if item.context}
        <span class="le-item__context">{item.context}</span>
    {/if}
    <span class="le-item__footer">
        <span class="le-item__kind">{kindLabel}</span>
        {#if item.meta}
            <span class="le-item__meta">{item.meta}</span>
        {/if}
    </span>
</button>

<style>
    .le-item {
        display: flex;
        flex-direction: column;
        gap: 3px;
        width: 100%;
        box-sizing: border-box;
        margin: 0 0 4px;
        padding: 7px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
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
        gap: 5px;
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
        font-size: 12px;
        line-height: 1.5;
        word-break: break-word;
    }

    .le-item__footer {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }

    .le-item__kind {
        flex: none;
        padding: 0 5px;
        border-radius: 4px;
        background: var(--b3-theme-surface-lighter);
        color: var(--b3-theme-on-surface);
        font-size: 10px;
        line-height: 16px;
    }

    .le-item--dead .le-item__kind {
        background: #fee2e2;
        color: #b91c1c;
    }

    .le-item__meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--b3-theme-on-surface);
        font-size: 11px;
        opacity: 0.8;
    }
</style>
