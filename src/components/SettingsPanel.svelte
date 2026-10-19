<script lang="ts">
    import { untrack } from "svelte";
    import type { LinkSettings } from "@/state.svelte";

    interface Props {
        settings: LinkSettings;
        labels: Record<string, string>;
        onSave: (settings: LinkSettings) => void;
        onCancel: () => void;
    }

    let { settings, labels, onSave, onCancel }: Props = $props();
    const initial = untrack(() => ({ ...settings }));

    let showMentions = $state(initial.showMentions);
    let showExternal = $state(initial.showExternal);
    let showAssets = $state(initial.showAssets);
    let showDead = $state(initial.showDead);
    let groupByDoc = $state(initial.groupByDoc);
    let autoRefresh = $state(initial.autoRefresh);
    let excludeDaily = $state(initial.excludeDaily);
    let excludeSelf = $state(initial.excludeSelf);
    let onlyNotebook = $state(initial.onlyNotebook);
    let maxItems = $state(initial.maxItems);

    function save() {
        onSave({
            ...initial,
            showMentions,
            showExternal,
            showAssets,
            showDead,
            groupByDoc,
            autoRefresh,
            excludeDaily,
            excludeSelf,
            onlyNotebook,
            maxItems: Math.min(2000, Math.max(50, Math.round(Number(maxItems) || 500))),
        });
    }
</script>

<div class="les-settings">
    <div class="les-settings__group">
        <div class="les-settings__title">{labels.settingsSections}</div>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={showMentions} />
            <span>{labels.showMentions}</span>
        </label>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={showExternal} />
            <span>{labels.showExternal}</span>
        </label>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={showAssets} />
            <span>{labels.showAssets}</span>
        </label>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={showDead} />
            <span>{labels.showDead}</span>
        </label>
    </div>

    <div class="les-settings__group">
        <div class="les-settings__title">{labels.settingsBehavior}</div>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={groupByDoc} />
            <span>{labels.groupByDoc}</span>
        </label>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={autoRefresh} />
            <span>{labels.autoRefresh}</span>
        </label>
        <label class="les-settings__field">
            <span>{labels.maxItems}</span>
            <input class="b3-text-field" type="number" min="50" max="2000" step="50" bind:value={maxItems} />
        </label>
        <small class="les-settings__hint">{labels.maxItemsHint}</small>
    </div>

    <div class="les-settings__group">
        <div class="les-settings__title">{labels.settingsFilters}</div>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={excludeDaily} />
            <span>{labels.excludeDaily}</span>
        </label>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={excludeSelf} />
            <span>{labels.excludeSelf}</span>
        </label>
        <label class="les-settings__check">
            <input type="checkbox" class="b3-switch" bind:checked={onlyNotebook} />
            <span>{labels.onlyNotebook}</span>
        </label>
    </div>

    <div class="les-settings__actions">
        <button type="button" class="b3-button b3-button--cancel" onclick={onCancel}>{labels.cancel}</button>
        <button type="button" class="b3-button b3-button--text" onclick={save}>{labels.save}</button>
    </div>
</div>

<style>
    .les-settings {
        display: flex;
        flex-direction: column;
        gap: 14px;
        height: 100%;
        box-sizing: border-box;
        padding: 16px;
        overflow: auto;
    }

    .les-settings__group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .les-settings__group:last-of-type {
        border-bottom: 0;
    }

    .les-settings__title {
        color: var(--b3-theme-on-surface);
        font-size: 12px;
        font-weight: 600;
    }

    .les-settings__check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
    }

    .les-settings__field {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
    }

    .les-settings__field span {
        flex: 1;
    }

    .les-settings__field input {
        width: 110px;
    }

    .les-settings__hint {
        color: var(--b3-theme-on-surface);
        font-size: 11px;
        line-height: 1.5;
    }

    .les-settings__actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: auto;
        padding-top: 10px;
    }
</style>
