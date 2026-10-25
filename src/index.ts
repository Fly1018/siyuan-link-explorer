import {
    Plugin,
    Menu,
    showMessage,
    openTab,
    getActiveEditor,
    getAllEditor,
    fetchSyncPost,
} from "siyuan";
import { mount, unmount } from "svelte";
import LinkPanel from "@/components/LinkPanel.svelte";
import SettingsPanel from "@/components/SettingsPanel.svelte";
import { svelteDialog } from "@/libs/dialog";
import {
    ID_RE,
    assetKindOf,
    assetOrder,
    basename,
    clip,
    countOccurrences,
    decodeEntities,
    domainOf,
    fullText,
    isEmbed,
    parseMarkdown,
    stripHtml,
    type AssetKind,
    type LinkItem,
    type LinkKind,
} from "@/logic/links";
import {
    deadDocsStmt,
    deadRefCountStmt,
    docCountStmt,
    refsStmt,
    topIncomingStmt,
    topOutgoingStmt,
} from "@/logic/sql";
import {
    DEFAULT_SETTINGS,
    ISOLATED_MAX,
    linkSettings,
    linkState,
    type HealthData,
    type HealthDoc,
    type IsolatedDoc,
    type LinkScope,
    type LinkSettings,
    type MissingAsset,
} from "@/state.svelte";
import "./index.scss";

interface RefRow {
    sourceBlockID?: string;
    sourceDocID?: string;
    targetBlockID?: string;
    targetDocID?: string;
    anchor?: string;
    markdown?: string;
    sourceText?: string;
    targetText?: string;
    sourceDocTitle?: string;
    targetDocTitle?: string;
    sourcePath?: string;
    targetPath?: string;
    sourceBox?: string;
    targetBox?: string;
    sourceUpdated?: string;
    targetUpdated?: string;
    refCount?: number;
}

interface TitleRow {
    id?: string;
    content?: string;
    hpath?: string;
    box?: string;
}

interface CountRow {
    count?: number;
}

interface HealthRow {
    id?: string;
    title?: string;
    hpath?: string;
    count?: number;
}

const DOCK_TYPE = "link-explorer";
const MAX_PER_LIST = 2000;
const MAX_MENTIONS = 50;
const MISSING_ASSETS_TTL = 60_000;

export default class LinkExplorer extends Plugin {
    private disposed = false;
    private refreshSeq = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private lastRootID = "";
    private lastBlockID = "";
    private panelApp: ReturnType<typeof mount> | null = null;
    private settingsDialog: ReturnType<typeof svelteDialog> | undefined;
    private dockElement: HTMLElement | null = null;
    private dockObserver: IntersectionObserver | null = null;
    private pendingRefresh = false;
    private pendingTimer: ReturnType<typeof setInterval> | null = null;
    /** Subject (doc/scope/block) whose data is currently rendered. */
    private renderedKey = "";
    /** Set when link data may have changed since the last successful refresh. */
    private dirty = false;
    private isolatedSeq = 0;
    private healthSeq = 0;
    private missingAssetsAt = 0;
    private missingAssetPaths = new Set<string>();
    private missingAssetList: MissingAsset[] = [];

    onload() {
        this.disposed = false;
        const plugin = this;
        this.eventBus.on("switch-protyle", this.onProtyleEvent);
        this.eventBus.on("loaded-protyle-static", this.onProtyleEvent);
        this.eventBus.on("destroy-protyle", this.onProtyleDestroy);
        this.eventBus.on("ws-main", this.onWs);
        document.addEventListener("selectionchange", this.onSelectionChange, true);

        this.addDock({
            config: {
                position: "RightTop",
                size: { width: 310, height: 0 },
                icon: "iconLink",
                title: this.t("dockTitle", "Link Overview"),
            },
            data: {},
            type: DOCK_TYPE,
            init() {
                const element = this.element as HTMLElement;
                plugin.dockElement = element;
                plugin.panelApp = mount(LinkPanel, {
                    target: element,
                    props: {
                        labels: plugin.labels(),
                        onRefresh: () => void (linkState.healthActive
                            ? plugin.openHealth()
                            : linkState.isolatedActive
                                ? plugin.openIsolatedDocs()
                                : plugin.refresh()),
                        onOpen: (item: LinkItem) => plugin.openItem(item),
                        onContextMenu: (event: MouseEvent, item: LinkItem) => plugin.showItemMenu(event, item),
                        onSettingsChange: (next: LinkSettings) => plugin.applySettings(next),
                        onOpenSettings: () => plugin.openSettings(),
                        onScopeChange: (scope: LinkScope) => plugin.setScope(scope),
                        onShowIsolated: () => void plugin.openIsolatedDocs(),
                        onCloseIsolated: () => plugin.closeIsolatedDocs(),
                        onOpenIsolated: (doc: IsolatedDoc) => plugin.openDoc(doc.id),
                        onShowHealth: () => void plugin.openHealth(),
                        onCloseHealth: () => plugin.closeHealth(),
                        onOpenHealthDoc: (doc: HealthDoc) => plugin.openDoc(doc.id),
                        onCopyReport: (text: string) => plugin.copyText(text),
                    },
                });
                // Auto-refresh is paused while the dock is hidden; catch up when it becomes visible.
                plugin.dockObserver?.disconnect();
                if (typeof IntersectionObserver !== "undefined") {
                    plugin.dockObserver = new IntersectionObserver((entries) => {
                        if (!plugin.pendingRefresh) return;
                        if (!entries.some((entry) => entry.isIntersecting)) return;
                        plugin.flushPendingRefresh();
                    });
                    plugin.dockObserver.observe(element);
                }
                if (plugin.pendingRefresh) plugin.flushPendingRefresh();
            },
            destroy() {
                plugin.dockObserver?.disconnect();
                plugin.dockObserver = null;
                plugin.clearPendingTimer();
                plugin.dockElement = null;
                if (plugin.panelApp) {
                    unmount(plugin.panelApp);
                    plugin.panelApp = null;
                }
            },
        });
    }

    async onLayoutReady() {
        if (this.disposed) return;
        await this.loadSettings();
        if (this.disposed) return;
        if (linkSettings.scope === "block" && !this.currentBlockID()) {
            linkSettings.scope = "doc";
            this.saveSettings();
        }
        linkState.scope = linkSettings.scope;
        void this.refresh();
    }

    onunload() {
        this.disposed = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.clearPendingTimer();
        this.eventBus.off("switch-protyle", this.onProtyleEvent);
        this.eventBus.off("loaded-protyle-static", this.onProtyleEvent);
        this.eventBus.off("destroy-protyle", this.onProtyleDestroy);
        this.eventBus.off("ws-main", this.onWs);
        document.removeEventListener("selectionchange", this.onSelectionChange, true);
        this.settingsDialog?.close();
        this.settingsDialog = undefined;
        this.dockObserver?.disconnect();
        this.dockObserver = null;
        this.dockElement = null;
        this.pendingRefresh = false;
        if (this.panelApp) {
            unmount(this.panelApp);
            this.panelApp = null;
        }
        this.resetState();
        this.isolatedSeq += 1;
        linkState.isolatedActive = false;
        linkState.isolatedLoading = false;
        linkState.isolatedError = "";
        linkState.isolatedDocs = [];
        linkState.isolatedHasMore = false;
        this.healthSeq += 1;
        linkState.healthActive = false;
        linkState.healthLoading = false;
        linkState.healthError = "";
        linkState.healthData = null;
    }

    private t(key: string, fallback: string): string {
        const value = (this.i18n as Record<string, unknown>)[key];
        return typeof value === "string" && value ? value : fallback;
    }

    private labels(): Record<string, string> {
        const keys = [
            "dockTitle", "refresh", "settings", "loading", "noDoc", "error",
            "untitled", "thisDoc", "scopeDoc", "scopeBlock", "needBlock", "showOnly", "showAll",
            "outgoing", "backlinks", "mentions", "externalLinks", "assets", "deadLinks",
            "emptyOutgoing", "emptyBacklinks", "emptyMentions", "emptyExternal",
            "emptyAssets", "emptyDead", "outgoingFlow", "backlinkFlow", "deadFlow", "noMatch",
            "assetImage", "assetVideo", "assetAudio", "assetPdf", "assetDocument", "assetArchive", "assetOther",
            "assetMissing", "missingAssetsNote", "noLinks",
            "isolated", "isolatedHint", "isolatedDocsHint", "isolatedEmpty", "isolatedLimit",
            "isolatedScanning", "backToLinks",
            "health", "healthHint", "healthDocs", "healthDeadRefs", "healthMissing",
            "healthDeadDocs", "healthTopOutgoing", "healthTopIncoming", "healthEmpty",
            "searchPlaceholder", "excludeDaily", "excludeSelf", "onlyNotebook",
            "reference", "embed", "mention", "external", "asset", "deadTarget",
            "mentionContext", "internalLink", "openFailed",
            "copyReference", "copyLink", "openLink", "openAsset", "openInNewTab",
            "openInSplitRight", "openInSplitBottom", "openSourceDoc", "openTargetDoc",
            "copied", "copyFailed", "copyReport", "collapseAll", "expandAll",
            "settingsTitle", "settingsSections", "settingsBehavior", "settingsFilters",
            "showMentions", "showExternal", "showAssets", "showDead",
            "groupByDoc", "autoRefresh", "maxItems", "maxItemsHint", "save", "cancel",
            "fontSize", "fontSizeHint", "hoverPreview", "previewClose",
            "hideEmptySections", "sortMode", "sortDefault", "sortTitle", "sortUpdated",
        ];
        const result: Record<string, string> = {};
        for (const key of keys) result[key] = this.t(key, key);
        return result;
    }

    private onSelectionChange = () => {
        const blockID = this.liveBlockID();
        if (blockID) this.lastBlockID = blockID;
    };

    private onProtyleEvent = (event: any) => {
        if (this.disposed) return;
        const rootID = event?.detail?.protyle?.block?.rootID || "";
        if (!rootID) return;
        // Clicking the dock icon re-emits switch-protyle for the same document;
        // that is a focus change, not a document switch, so nothing to reload
        // unless edits are pending.
        const docSwitched = rootID !== this.lastRootID;
        if (docSwitched) this.lastBlockID = "";
        this.lastRootID = rootID;
        if (!docSwitched && !this.dirty) return;
        this.dirty = true;
        this.scheduleRefresh(true);
    };

    private onProtyleDestroy = (event: any) => {
        if (this.disposed) return;
        const protyle = event?.detail?.protyle;
        const rootID = protyle?.block?.rootID || "";
        if (!rootID || rootID !== this.lastRootID) return;
        // A closing search preview or split must not clear a document that is
        // still open in another editor.
        const stillOpen = getAllEditor().some((editor) =>
            editor?.protyle !== protyle && editor?.protyle?.block?.rootID === rootID);
        if (stillOpen) return;
        this.lastRootID = "";
        this.lastBlockID = "";
        this.dirty = true;
        this.scheduleRefresh(true);
    };

    private onWs = (event: any) => {
        if (this.disposed) return;
        if (event?.detail?.cmd !== "transactions") return;
        if (!linkSettings.autoRefresh) return;
        if (!this.currentRootID()) return;
        this.dirty = true;
        this.scheduleRefresh(false);
    };

    private scheduleRefresh(force: boolean) {
        if (this.disposed) return;
        if (!force && !linkSettings.autoRefresh) return;
        if (!this.isDockVisible()) {
            // Keep the refresh pending instead of querying the kernel for a hidden dock.
            this.markPending();
            return;
        }
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.refresh();
        }, 700);
    }

    private markPending() {
        this.pendingRefresh = true;
        if (this.pendingTimer) return;
        // IntersectionObserver can report a zero-width (hidden) dock as
        // intersecting, so it never fires again when the dock opens. Poll the
        // real layout while a refresh is owed; it stops as soon as it flushes.
        this.pendingTimer = setInterval(() => {
            if (this.disposed) {
                this.clearPendingTimer();
                return;
            }
            if (!this.pendingRefresh) {
                this.clearPendingTimer();
                return;
            }
            if (this.isDockVisible()) this.flushPendingRefresh();
        }, 500);
    }

    /** Identity of the subject whose links are currently rendered. */
    private currentSubjectKey(): string {
        const rootID = this.currentRootID();
        const scope = linkSettings.scope;
        const blockID = scope === "block" ? this.currentBlockID() : "";
        return `${rootID}|${scope}|${blockID}`;
    }

    private flushPendingRefresh() {
        if (this.disposed || !this.pendingRefresh) return;
        this.pendingRefresh = false;
        this.clearPendingTimer();
        // Opening the dock must not feel like a reload: when nothing changed,
        // keep the rendered list untouched; when the subject changed, drop the
        // stale list immediately and query without the edit debounce.
        const key = this.currentSubjectKey();
        if (key === this.renderedKey && !this.dirty) return;
        const rootID = this.currentRootID();
        if (rootID && rootID !== linkState.docID) {
            this.resetState();
            linkState.loading = true;
        }
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        void this.refresh();
    }

    private clearPendingTimer() {
        if (this.pendingTimer) {
            clearInterval(this.pendingTimer);
            this.pendingTimer = null;
        }
    }

    private isDockVisible(): boolean {
        const element = this.dockElement;
        return Boolean(element && element.isConnected && element.getClientRects().length > 0);
    }

    private currentRootID(): string {
        try {
            const editor = getActiveEditor();
            const rootID = editor?.protyle?.block?.rootID || "";
            if (rootID) {
                this.lastRootID = rootID;
                return rootID;
            }
        } catch (error) {
            // fall back
        }
        return this.lastRootID;
    }

    private currentNotebookID(): string {
        try {
            return getActiveEditor()?.protyle?.notebookId || "";
        } catch (error) {
            return "";
        }
    }

    private async resolveNotebookID(): Promise<string> {
        const docID = linkState.docID || this.lastRootID;
        if (!docID || !ID_RE.test(docID)) return "";
        try {
            const rows = await this.post<Array<{ box?: string }>>("/api/query/sql", {
                stmt: `SELECT box FROM blocks WHERE id = '${docID}' LIMIT 1`,
            });
            return String(rows?.[0]?.box || "");
        } catch (error) {
            return "";
        }
    }

    /** Missing asset files in the workspace, cached briefly to avoid a call per refresh. */
    private async loadMissingAssets(): Promise<{ paths: Set<string>; list: MissingAsset[] }> {
        if (Date.now() - this.missingAssetsAt < MISSING_ASSETS_TTL) {
            return { paths: this.missingAssetPaths, list: this.missingAssetList };
        }
        try {
            const data = await this.post<Array<{ path?: string; item?: string; name?: string }> | null>("/api/asset/getMissingAssets", {});
            const list: MissingAsset[] = (data || [])
                .map((item) => ({ path: String(item?.path || item?.item || ""), name: item?.name }))
                .filter((item) => item.path);
            this.missingAssetPaths = new Set(list.map((item) => item.path));
            this.missingAssetList = list;
            this.missingAssetsAt = Date.now();
        } catch (error) {
            // Read-only or publish mode may refuse the call; keep the last result.
        }
        return { paths: this.missingAssetPaths, list: this.missingAssetList };
    }

    private liveBlockID(): string {
        try {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const node = selection.anchorNode;
                const element = node && (node.nodeType === 1 ? node as Element : node.parentElement);
                const block = element?.closest?.('[data-node-id]') as HTMLElement | null;
                if (block?.closest?.(".protyle-wysiwyg")) {
                    return block.getAttribute("data-node-id") || "";
                }
            }

            // Clicking the dock takes focus away from the editor. Protyle keeps
            // the last caret in toolbar.range, so use it before falling back to
            // the runtime selection class.
            const protyle = getActiveEditor()?.protyle as any;
            const saved = protyle?.toolbar?.range as Range | undefined;
            if (saved?.startContainer) {
                const node = saved.startContainer;
                const element = node.nodeType === 1 ? node as Element : node.parentElement;
                const block = element?.closest?.('[data-node-id]') as HTMLElement | null;
                if (block?.closest?.(".protyle-wysiwyg")) {
                    return block.getAttribute("data-node-id") || "";
                }
            }

            const selected = document.querySelector<HTMLElement>(".protyle-wysiwyg .protyle-wysiwyg--select");
            return selected?.getAttribute("data-node-id") || "";
        } catch (error) {
            return "";
        }
    }

    private currentBlockID(): string {
        const live = this.liveBlockID();
        if (live) {
            this.lastBlockID = live;
            return live;
        }
        return this.lastBlockID;
    }

    private async post<T>(url: string, payload: Record<string, unknown>): Promise<T> {
        const response = await fetchSyncPost(url, payload);
        if (!response || typeof response.code !== "number") {
            throw new Error(this.t("error", "Failed to load links"));
        }
        if (response.code !== 0) {
            throw new Error(response.msg || this.t("error", "Failed to load links"));
        }
        return response.data as T;
    }

    private resetState() {
        linkState.docID = "";
        linkState.docTitle = "";
        linkState.notebookID = "";
        linkState.scope = linkSettings.scope;
        linkState.scopeBlockID = "";
        linkState.scopeBlockTitle = "";
        linkState.loading = false;
        linkState.error = "";
        linkState.outgoing = [];
        linkState.backlinks = [];
        linkState.mentions = [];
        linkState.external = [];
        linkState.assets = [];
        linkState.dead = [];
    }

    private async refresh() {
        if (this.disposed) return;
        const rootID = this.currentRootID();
        if (!rootID || !ID_RE.test(rootID)) {
            this.renderedKey = "";
            this.dirty = false;
            this.resetState();
            return;
        }

        const notebookID = this.currentNotebookID();
        let scope = linkSettings.scope;
        let blockID = scope === "block" ? this.currentBlockID() : "";
        const seq = ++this.refreshSeq;
        const subjectKey = `${rootID}|${scope}|${blockID}`;

        if (scope === "block" && (!blockID || !ID_RE.test(blockID))) {
            scope = "doc";
            blockID = "";
            linkSettings.scope = "doc";
            linkState.scope = "doc";
            this.saveSettings();
        }

        // Keep the current list on screen while re-querying the same subject;
        // the loading state is only for a subject the panel has not shown yet.
        linkState.loading = subjectKey !== this.renderedKey;
        linkState.error = "";
        linkState.scope = scope;

        const subjectID = blockID || rootID;
        const max = Math.min(MAX_PER_LIST, Math.max(50, Math.round(Number(linkSettings.maxItems) || 500)));

        try {
            const titleRows = await this.post<TitleRow[]>("/api/query/sql", {
                stmt: `SELECT id, content, hpath, box FROM blocks WHERE id IN ('${rootID}'` +
                    (blockID ? `, '${blockID}'` : "") + `)`,
            });
            if (this.disposed || seq !== this.refreshSeq) return;
            const docRow = (titleRows || []).find((row) => row.id === rootID);
            const blockRow = blockID ? (titleRows || []).find((row) => row.id === blockID) : undefined;
            const docTitle = clip(docRow?.content, 200) || this.t("untitled", "Untitled");
            const blockTitle = clip(blockRow?.content, 200) || "";
            const docPath = String(docRow?.hpath || "");
            // getActiveEditor() can fail while the dock has focus; the document's
            // own box is authoritative and also drives the notebook filter.
            const resolvedNotebookID = notebookID || String(docRow?.box || "");
            if (linkState.notebookID && resolvedNotebookID && resolvedNotebookID !== linkState.notebookID) {
                if (linkState.isolatedActive) linkState.isolatedActive = false;
                if (linkState.healthActive) linkState.healthActive = false;
            }
            linkState.notebookID = resolvedNotebookID;

            if (scope === "block" && !blockRow) {
                linkState.docID = rootID;
                linkState.docTitle = docTitle;
                linkState.scopeBlockID = "";
                linkState.scopeBlockTitle = "";
                linkState.outgoing = [];
                linkState.backlinks = [];
                linkState.mentions = [];
                linkState.external = [];
                linkState.assets = [];
                linkState.dead = [];
                linkState.error = this.t("needBlock", "Place the caret inside a block first");
                linkState.loading = false;
                this.renderedKey = subjectKey;
                this.dirty = false;
                return;
            }

            linkState.docID = rootID;
            linkState.docTitle = docTitle;
            linkState.scopeBlockID = blockID;
            linkState.scopeBlockTitle = blockTitle;

            const [outgoingRows, backlinkRows, deadRows] = await Promise.all([
                this.post<RefRow[]>("/api/query/sql", { stmt: refsStmt(rootID, blockID, "outgoing", max) }),
                this.post<RefRow[]>("/api/query/sql", { stmt: refsStmt(rootID, blockID, "backlinks", max) }),
                this.post<RefRow[]>("/api/query/sql", { stmt: refsStmt(rootID, blockID, "dead", max) }),
            ]);
            if (this.disposed || seq !== this.refreshSeq) return;

            const outgoing = this.mapRefs(outgoingRows, "outgoing", docTitle);
            const backlinks = this.mapRefs(backlinkRows, "backlinks", docTitle);
            const dead = this.mapRefs(deadRows, "dead", docTitle);

            // Mentions and Markdown parsing are independent; run them together.
            const [mentions, markdown] = await Promise.all([
                scope === "doc"
                    // Mentions are always collected: the isolated-document badge
                    // needs them even when the mentions section is hidden.
                    ? this.loadMentions(rootID, resolvedNotebookID, docTitle, docPath, linkSettings.showMentions)
                        .catch((error) => {
                            console.warn("[siyuan-link-explorer] mentions failed", error);
                            return [] as LinkItem[];
                        })
                    : Promise.resolve([] as LinkItem[]),
                linkSettings.showExternal || linkSettings.showAssets
                    ? this.loadMarkdown(subjectID, scope, rootID)
                    : Promise.resolve(""),
            ]);
            if (this.disposed || seq !== this.refreshSeq) return;

            let external: LinkItem[] = [];
            let assets: LinkItem[] = [];
            if (markdown) {
                const parsed = parseMarkdown(markdown, {
                    sourceDocID: rootID,
                    sourceDocTitle: docTitle,
                    sourcePath: docPath,
                    sourceBox: resolvedNotebookID,
                    targetDocID: "",
                    targetPath: "",
                    targetBox: "",
                    group: this.t("thisDoc", "This document"),
                    self: false,
                }, (key, fallback) => this.t(key, fallback));
                external = parsed.external;
                assets = parsed.assets;
                if (parsed.internal.length) {
                    const seen = new Set(outgoing.map((item) => item.id));
                    for (const item of parsed.internal) {
                        if (!seen.has(item.id)) {
                            seen.add(item.id);
                            outgoing.push(item);
                        }
                    }
                }
            }

            if (assets.length) {
                const missing = await this.loadMissingAssets();
                if (this.disposed || seq !== this.refreshSeq) return;
                for (const item of assets) {
                    if (item.url) item.assetMissing = missing.paths.has(item.url);
                }
            }

            // The refs table stores one row per source/target pair; count the
            // actual occurrences inside the source blocks in one batched call.
            await this.applyRefCounts([...outgoing, ...backlinks, ...dead]);
            if (this.disposed || seq !== this.refreshSeq) return;

            if (this.disposed || seq !== this.refreshSeq) return;
            assets.sort((a, b) => assetOrder(a.assetKind) - assetOrder(b.assetKind));
            linkState.outgoing = outgoing.slice(0, max);
            linkState.backlinks = backlinks.slice(0, max);
            linkState.mentions = mentions.slice(0, max);
            linkState.external = external.slice(0, max);
            linkState.assets = assets.slice(0, max);
            linkState.dead = dead.slice(0, max);
        } catch (error: any) {
            if (this.disposed || seq !== this.refreshSeq) return;
            linkState.error = error?.message || this.t("error", "Failed to load links");
            linkState.outgoing = [];
            linkState.backlinks = [];
            linkState.mentions = [];
            linkState.external = [];
            linkState.assets = [];
            linkState.dead = [];
        } finally {
            if (!this.disposed && seq === this.refreshSeq) {
                linkState.loading = false;
                this.renderedKey = subjectKey;
                this.dirty = false;
            }
        }
    }

    private mapRefs(rows: RefRow[], mode: "outgoing" | "backlinks" | "dead", docTitle: string): LinkItem[] {
        const items: LinkItem[] = [];
        // The SQL groups by source/target pair, so each row is already unique and
        // refCount carries how many times that pair is referenced.
        for (const row of rows) {
            const sourceDocID = String(row.sourceDocID || "");
            const targetDocID = String(row.targetDocID || "");
            const sourceBox = String(row.sourceBox || "");
            const targetBox = String(row.targetBox || "");
            const sourcePath = String(row.sourcePath || "");
            const targetPath = String(row.targetPath || "");
            const anchor = clip(row.anchor, 200);
            const sourceText = clip(row.sourceText, 260);
            const targetText = clip(row.targetText, 260);
            const sourceDocTitle = clip(row.sourceDocTitle, 200);
            const targetDocTitle = clip(row.targetDocTitle, 200);
            const self = Boolean(sourceDocID && targetDocID && sourceDocID === targetDocID);
            const kind: LinkKind = isEmbed(row.markdown) ? "embed" : "reference";
            const count = Math.max(1, Number(row.refCount) || 1);

            if (mode === "outgoing") {
                const id = String(row.targetBlockID || "");
                if (!id) continue;
                const key = `outgoing:${String(row.sourceBlockID || "")}:${id}`;
                const title = self
                    ? (targetText || anchor || targetDocTitle || this.t("untitled", "Untitled"))
                    : (targetDocTitle || targetText || anchor || this.t("untitled", "Untitled"));
                items.push({
                    id,
                    key,
                    title,
                    context: sourceText || anchor,
                    fullContext: fullText(row.sourceText || row.anchor || row.targetText),
                    meta: anchor && anchor !== title ? anchor : (targetText && targetText !== title ? targetText : ""),
                    kind,
                    count,
                    sourceBlockID: String(row.sourceBlockID || ""),
                    refTargetID: id,
                    updated: String(row.targetUpdated || ""),
                    group: targetDocTitle || this.t("thisDoc", "This document"),
                    sourceDocID,
                    targetDocID,
                    sourcePath,
                    targetPath,
                    sourceBox,
                    targetBox,
                    self,
                });
                continue;
            }

            if (mode === "dead") {
                const id = String(row.sourceBlockID || "");
                if (!id) continue;
                const key = `dead:${id}:${String(row.targetBlockID || "")}`;
                items.push({
                    id,
                    key,
                    title: this.t("deadTarget", "Target is missing"),
                    context: sourceText || anchor,
                    fullContext: fullText(sourceText || anchor || targetText),
                    meta: anchor || String(row.targetBlockID || ""),
                    kind: "dead",
                    count,
                    sourceBlockID: id,
                    refTargetID: String(row.targetBlockID || ""),
                    updated: String(row.sourceUpdated || ""),
                    group: sourceDocTitle || docTitle,
                    sourceDocID,
                    targetDocID,
                    sourcePath,
                    targetPath,
                    sourceBox,
                    targetBox,
                    self,
                });
                continue;
            }

            const id = String(row.sourceBlockID || "");
            if (!id) continue;
            const key = `backlinks:${id}:${String(row.targetBlockID || "")}`;
            items.push({
                id,
                key,
                title: self
                    ? (sourceText || anchor || sourceDocTitle || this.t("untitled", "Untitled"))
                    : (sourceDocTitle || sourceText || anchor || this.t("untitled", "Untitled")),
                context: sourceText || anchor,
                fullContext: fullText(row.sourceText || row.anchor || row.targetText),
                meta: anchor || targetText,
                kind,
                count,
                sourceBlockID: id,
                refTargetID: String(row.targetBlockID || ""),
                updated: String(row.sourceUpdated || ""),
                group: sourceDocTitle || docTitle,
                sourceDocID,
                targetDocID,
                sourcePath,
                targetPath,
                sourceBox,
                targetBox,
                self,
            });
        }
        return items;
    }

    private async applyRefCounts(items: LinkItem[]): Promise<void> {
        const ids = Array.from(new Set(items
            .map((item) => item.sourceBlockID)
            .filter((id): id is string => Boolean(id && ID_RE.test(id)))));
        if (!ids.length) return;
        // A paragraph referencing the same block ten times contributes one refs
        // row, so fetch the source kramdown in one batch and count occurrences.
        let kramdowns: Record<string, string> = {};
        try {
            const response = await fetchSyncPost("/api/block/getBlockKramdowns", { ids: ids.slice(0, 200) });
            if (response?.code === 0 && response.data) kramdowns = response.data;
        } catch (error) {
            return;
        }
        for (const item of items) {
            const md = item.sourceBlockID ? kramdowns[item.sourceBlockID] : "";
            if (!md || !item.refTargetID) continue;
            const count = countOccurrences(md, item.refTargetID);
            if (count > 1) item.count = count;
        }
    }

    private async loadMentions(
        rootID: string,
        notebookID: string,
        docTitle: string,
        docPath: string,
        withContext = true,
    ): Promise<LinkItem[]> {
        const response = await fetchSyncPost("/api/ref/getBacklink2", {
            id: rootID,
            k: "",
            mk: "",
            includeBacklinks: false,
            includeMentions: true,
        });
        if (!response || response.code !== 0) return [];
        const paths = Array.isArray(response.data?.backmentions) ? response.data.backmentions : [];

        const docs: Array<{ sourceDocID: string; path: any }> = [];
        const seenDocs = new Set<string>();
        for (const path of paths.slice(0, MAX_MENTIONS)) {
            const sourceDocID = String(path?.id || "");
            if (!sourceDocID || !ID_RE.test(sourceDocID) || seenDocs.has(sourceDocID)) continue;
            seenDocs.add(sourceDocID);
            docs.push({ sourceDocID, path });
        }

        // Resolve every mention context with one query instead of one per document.
        const contexts = new Map<string, { id: string; content: string }>();
        const title = String(docTitle || "").replace(/'/g, "''");
        if (withContext && title && title !== this.t("untitled", "Untitled") && docs.length) {
            try {
                const ids = docs.map((doc) => `'${doc.sourceDocID}'`).join(",");
                const rows = await this.post<Array<{ id?: string; root_id?: string; content?: string }>>("/api/query/sql", {
                    stmt: `SELECT b.id, b.root_id, b.content FROM blocks b JOIN (` +
                        `SELECT root_id, MIN(id) AS id FROM blocks ` +
                        `WHERE root_id IN (${ids}) AND instr(content, '${title}') > 0 ` +
                        `GROUP BY root_id) m ON b.id = m.id`,
                });
                for (const row of rows || []) {
                    const root = String(row.root_id || "");
                    if (root && row.id) {
                        contexts.set(root, { id: String(row.id), content: String(row.content || "") });
                    }
                }
            } catch (error) {
                // Keep the document-level fallback.
            }
        }

        const fallbackContext = this.t("mentionContext", "Mentioned in the document body");
        const items: LinkItem[] = [];
        for (const { sourceDocID, path } of docs) {
            const match = contexts.get(sourceDocID);
            const blockID = match?.id || sourceDocID;
            const context = clip(match?.content, 260) || fallbackContext;
            const sourceDocTitle = clip(path?.name, 200) || this.t("untitled", "Untitled");
            items.push({
                id: blockID,
                key: `mention:${sourceDocID}`,
                title: sourceDocTitle,
                context,
                fullContext: fullText(context),
                meta: docTitle,
                kind: "mention",
                updated: String(path?.updated || ""),
                group: sourceDocTitle,
                sourceDocID,
                targetDocID: rootID,
                sourcePath: String(path?.hPath || ""),
                targetPath: docPath,
                sourceBox: String(path?.box || ""),
                targetBox: notebookID,
                self: sourceDocID === rootID,
            });
        }
        return items;
    }

    private async loadMarkdown(subjectID: string, scope: LinkScope, rootID: string): Promise<string> {
        try {
            if (scope === "block") {
                const response = await fetchSyncPost("/api/block/getBlockKramdown", { id: subjectID });
                if (response?.code === 0) return String(response.data?.kramdown || "");
            }
            const response = await fetchSyncPost("/api/export/exportMdContent", { id: scope === "doc" ? subjectID : rootID });
            if (response?.code === 0) return String(response.data?.content || "");
            const fallback = await fetchSyncPost("/api/block/getBlockKramdown", { id: rootID });
            return fallback?.code === 0 ? String(fallback.data?.kramdown || "") : "";
        } catch (error) {
            return "";
        }
    }

    private openItem(item: LinkItem, position?: "right" | "bottom") {
        if (!item) return;
        try {
            if (item.kind === "external" && item.url) {
                this.openExternal(item.url);
                return;
            }
            if (item.kind === "asset" && item.url) {
                openTab({ app: this.app, asset: { path: item.url }, position });
                return;
            }
            if (!item.id) return;
            openTab({
                app: this.app,
                doc: { id: item.id, action: ["cb-get-focus", "cb-get-hl"] as any },
                position,
            });
        } catch (error) {
            console.error("[siyuan-link-explorer] open item failed", error);
            showMessage(this.t("openFailed", "Could not open the target block"), 4000, "error");
        }
    }

    private openDoc(id: string) {
        if (!id) return;
        try {
            openTab({ app: this.app, doc: { id, action: ["cb-get-focus"] as any } });
        } catch (error) {
            console.error("[siyuan-link-explorer] open document failed", error);
            showMessage(this.t("openFailed", "Could not open the target block"), 4000, "error");
        }
    }

    private async openIsolatedDocs() {
        let notebookID = linkState.notebookID || this.currentNotebookID();
        if (!notebookID || !ID_RE.test(notebookID)) {
            notebookID = await this.resolveNotebookID();
        }
        if (!notebookID || !ID_RE.test(notebookID)) {
            showMessage(this.t("noDoc", "请先打开一个文档"), 3000, "info");
            return;
        }

        // The list is rendered in the dock panel, so show it before scanning.
        const token = ++this.isolatedSeq;
        linkState.healthActive = false;
        linkState.isolatedActive = true;
        linkState.isolatedLoading = true;
        linkState.isolatedError = "";
        linkState.isolatedDocs = [];
        linkState.isolatedHasMore = false;

        let rows: Array<{ id?: string; content?: string; hpath?: string }> = [];
        try {
            rows = await this.post<Array<{ id?: string; content?: string; hpath?: string }>>("/api/query/sql", {
                stmt: `SELECT b.id, b.content, b.hpath FROM blocks b ` +
                    `WHERE b.type = 'd' AND b.box = '${notebookID}' ` +
                    // Only live references count as outgoing, matching the panel badge.
                    `AND NOT EXISTS (SELECT 1 FROM refs r JOIN blocks tb ON tb.id = r.def_block_id ` +
                    `WHERE r.root_id = b.id) ` +
                    `AND NOT EXISTS (SELECT 1 FROM refs r JOIN blocks tb ON tb.id = r.def_block_id ` +
                    `WHERE (r.def_block_root_id = b.id OR r.def_block_id = b.id) AND tb.id IS NOT NULL) ` +
                    `ORDER BY b.updated DESC LIMIT ${ISOLATED_MAX + 1}`,
            });
        } catch (error) {
            console.error("[siyuan-link-explorer] isolated docs query failed", error);
            if (token === this.isolatedSeq) {
                linkState.isolatedError = this.t("error", "读取链接失败");
                linkState.isolatedLoading = false;
            }
            return;
        }
        if (token !== this.isolatedSeq) return;

        const hasMore = (rows?.length || 0) > ISOLATED_MAX;
        const candidates = (rows || []).filter((row) => row.id).slice(0, ISOLATED_MAX);
        const toDoc = (row: { id?: string; content?: string; hpath?: string }): IsolatedDoc => ({
            id: String(row.id),
            title: clip(row.content, 200) || this.t("untitled", "Untitled"),
            hpath: String(row.hpath || ""),
        });
        const checkMentions = async (row: { id?: string; content?: string; hpath?: string }) => {
            const doc = toDoc(row);
            try {
                const response = await fetchSyncPost("/api/ref/getBacklink2", {
                    id: doc.id,
                    k: "",
                    mk: "",
                    includeBacklinks: false,
                    includeMentions: true,
                });
                const mentions = Array.isArray(response?.data?.backmentions) ? response.data.backmentions : [];
                return mentions.length === 0 ? doc : null;
            } catch (error) {
                // If mentions cannot be checked, keep the document rather than hiding it.
                return doc;
            }
        };

        const isolated: IsolatedDoc[] = [];
        for (let i = 0; i < candidates.length; i += 10) {
            const batch = await Promise.all(candidates.slice(i, i + 10).map(checkMentions));
            if (token !== this.isolatedSeq) return;
            for (const item of batch) {
                if (item) isolated.push(item);
            }
        }
        isolated.sort((a, b) => a.hpath.localeCompare(b.hpath) || a.title.localeCompare(b.title));
        if (token !== this.isolatedSeq) return;

        linkState.isolatedDocs = isolated;
        linkState.isolatedHasMore = hasMore;
        linkState.isolatedLoading = false;
    }

    private closeIsolatedDocs() {
        this.isolatedSeq += 1;
        linkState.isolatedActive = false;
        linkState.isolatedLoading = false;
        linkState.isolatedError = "";
        void this.refresh();
    }

    private async openHealth() {
        let notebookID = linkState.notebookID || this.currentNotebookID();
        if (!notebookID || !ID_RE.test(notebookID)) {
            notebookID = await this.resolveNotebookID();
        }
        if (!notebookID || !ID_RE.test(notebookID)) {
            showMessage(this.t("noDoc", "请先打开一个文档"), 3000, "info");
            return;
        }

        const token = ++this.healthSeq;
        linkState.isolatedActive = false;
        linkState.healthActive = true;
        linkState.healthLoading = true;
        linkState.healthError = "";
        linkState.healthData = null;

        try {
            const [docCount, deadCount, deadDocs, topOut, topIn, missing] = await Promise.all([
                this.post<CountRow[]>("/api/query/sql", { stmt: docCountStmt(notebookID) }),
                this.post<CountRow[]>("/api/query/sql", { stmt: deadRefCountStmt(notebookID) }),
                this.post<HealthRow[]>("/api/query/sql", { stmt: deadDocsStmt(notebookID, 5) }),
                this.post<HealthRow[]>("/api/query/sql", { stmt: topOutgoingStmt(notebookID, 5) }),
                this.post<HealthRow[]>("/api/query/sql", { stmt: topIncomingStmt(notebookID, 5) }),
                this.loadMissingAssets(),
            ]);
            if (token !== this.healthSeq || this.disposed) return;
            const toDocs = (rows: HealthRow[] | null): HealthDoc[] => (rows || [])
                .filter((row) => row.id)
                .map((row) => ({
                    id: String(row.id),
                    title: clip(row.title, 200) || this.t("untitled", "Untitled"),
                    hpath: String(row.hpath || ""),
                    count: Number(row.count) || 0,
                }));
            const data: HealthData = {
                docs: Number(docCount?.[0]?.count) || 0,
                deadRefs: Number(deadCount?.[0]?.count) || 0,
                deadDocs: toDocs(deadDocs),
                topOutgoing: toDocs(topOut),
                topIncoming: toDocs(topIn),
                missingAssets: missing.list.slice(0, 500),
            };
            linkState.healthData = data;
            linkState.healthLoading = false;
        } catch (error) {
            if (token !== this.healthSeq || this.disposed) return;
            linkState.healthError = error instanceof Error ? error.message : this.t("error", "读取链接失败");
            linkState.healthLoading = false;
        }
    }

    private closeHealth() {
        this.healthSeq += 1;
        linkState.healthActive = false;
        linkState.healthLoading = false;
        linkState.healthError = "";
        void this.refresh();
    }

    private blockRef(item: LinkItem): string {
        const label = String(item.meta || item.title || "")
            .replace(/"/g, "＂")
            .replace(/\)\)/g, ") )");
        return `((${item.id} "${label}"))`;
    }

    private copyText(text: string) {
        if (!text) return;
        const done = () => showMessage(this.t("copied", "Copied"), 3000);
        const fail = () => showMessage(this.t("copyFailed", "Copy failed"), 4000, "error");
        try {
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => this.copyFallback(text, done, fail));
            } else {
                this.copyFallback(text, done, fail);
            }
        } catch (error) {
            this.copyFallback(text, done, fail);
        }
    }

    private copyFallback(text: string, done: () => void, fail: () => void) {
        try {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            const ok = document.execCommand("copy");
            textarea.remove();
            if (ok) done();
            else fail();
        } catch (error) {
            fail();
        }
    }

    private showItemMenu(event: MouseEvent, item: LinkItem) {
        if (this.disposed) return;
        event.preventDefault();
        event.stopPropagation();
        const menu = new Menu("link-explorer-item");
        if (item.kind === "external") {
            menu.addItem({
                icon: "iconLink",
                label: this.t("openLink", "Open link"),
                click: () => this.openExternal(item.url || item.id),
            });
            menu.addItem({
                icon: "iconCopy",
                label: this.t("copyLink", "Copy link"),
                click: () => this.copyText(item.url || item.id),
            });
        } else if (item.kind === "asset") {
            menu.addItem({
                icon: "iconOpen",
                label: this.t("openAsset", "Open asset"),
                click: () => this.openItem(item),
            });
            menu.addItem({
                icon: "iconCopy",
                label: this.t("copyLink", "Copy link"),
                click: () => this.copyText(item.url || item.id),
            });
        } else {
            menu.addItem({
                icon: "iconCopy",
                label: this.t("copyReference", "Copy block reference"),
                click: () => this.copyText(this.blockRef(item)),
            });
            menu.addItem({
                icon: "iconOpen",
                label: this.t("openInNewTab", "Open in new tab"),
                click: () => this.openItem(item),
            });
            menu.addItem({
                icon: "iconSplitLR",
                label: this.t("openInSplitRight", "Open in split right"),
                click: () => this.openItem(item, "right"),
            });
            menu.addItem({
                icon: "iconSplitTB",
                label: this.t("openInSplitBottom", "Open in split bottom"),
                click: () => this.openItem(item, "bottom"),
            });
            if (item.sourceDocID && item.sourceDocID !== linkState.docID) {
                menu.addSeparator();
                menu.addItem({
                    icon: "iconFile",
                    label: this.t("openSourceDoc", "Open source document"),
                    click: () => this.openDoc(item.sourceDocID),
                });
            } else if (item.targetDocID && item.targetDocID !== linkState.docID) {
                menu.addSeparator();
                menu.addItem({
                    icon: "iconFile",
                    label: this.t("openTargetDoc", "Open target document"),
                    click: () => this.openDoc(item.targetDocID),
                });
            }
        }
        menu.open({ x: event.clientX, y: event.clientY });
    }

    private openExternal(url: string) {
        if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) return;
        try {
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            anchor.style.display = "none";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        } catch (error) {
            console.error("[siyuan-link-explorer] open external failed", error);
            showMessage(this.t("openFailed", "Could not open the target block"), 4000, "error");
        }
    }

    private sanitizeSettings(raw: any): LinkSettings {
        const settings: LinkSettings = { ...DEFAULT_SETTINGS };
        if (!raw || typeof raw !== "object") return settings;
        for (const key of [
            "showMentions", "showExternal", "showAssets", "showDead",
            "groupByDoc", "autoRefresh", "excludeDaily", "excludeSelf", "onlyNotebook",
            "hoverPreview", "hideEmptySections",
        ] as const) {
            if (typeof raw[key] === "boolean") settings[key] = raw[key];
        }
        const max = Number(raw.maxItems);
        if (Number.isFinite(max)) settings.maxItems = Math.min(MAX_PER_LIST, Math.max(50, Math.round(max)));
        const size = Number(raw.fontSize);
        if (Number.isFinite(size)) settings.fontSize = Math.min(25, Math.max(10, Math.round(size)));
        if (raw.scope === "block") settings.scope = "block";
        if (raw.sortMode === "title" || raw.sortMode === "updated") settings.sortMode = raw.sortMode;
        return settings;
    }

    private async loadSettings() {
        try {
            const stored = await this.loadData("settings");
            Object.assign(linkSettings, this.sanitizeSettings(stored));
        } catch (error) {
            console.warn("[siyuan-link-explorer] load settings failed", error);
        }
    }

    private saveSettings() {
        try {
            const request = this.saveData("settings", { ...linkSettings });
            if (request && typeof request.then === "function") request.catch(() => undefined);
        } catch (error) {
            console.warn("[siyuan-link-explorer] save settings failed", error);
        }
    }

    private applySettings(next: LinkSettings) {
        Object.assign(linkSettings, this.sanitizeSettings(next));
        this.saveSettings();
    }

    private setScope(scope: LinkScope) {
        if (scope === "block" && !this.currentBlockID()) {
            const message = this.t("needBlock", "Place the caret inside a block first");
            linkSettings.scope = "block";
            linkState.scope = "block";
            linkState.scopeBlockID = "";
            linkState.scopeBlockTitle = "";
            linkState.outgoing = [];
            linkState.backlinks = [];
            linkState.mentions = [];
            linkState.external = [];
            linkState.assets = [];
            linkState.dead = [];
            linkState.error = message;
            showMessage(message, 4000);
            this.saveSettings();
            window.setTimeout(() => {
                if (linkState.error === message) linkState.error = "";
            }, 4000);
            return;
        }
        linkSettings.scope = scope;
        linkState.scope = scope;
        this.saveSettings();
        void this.refresh();
    }

    private openSettings() {
        if (this.settingsDialog) return;
        let handle: ReturnType<typeof svelteDialog>;
        handle = svelteDialog({
            title: this.t("settingsTitle", "Link Overview settings"),
            component: SettingsPanel,
            width: "480px",
            props: {
                settings: { ...linkSettings },
                labels: this.labels(),
                onSave: (next: LinkSettings) => {
                    this.applySettings(next);
                    handle.close();
                    void this.refresh();
                },
                onCancel: () => handle.close(),
            },
            callback: () => {
                if (this.settingsDialog === handle) this.settingsDialog = undefined;
            },
        });
        this.settingsDialog = handle;
    }
}
