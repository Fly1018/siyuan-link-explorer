import {
    Plugin,
    Menu,
    showMessage,
    openTab,
    getActiveEditor,
    fetchSyncPost,
} from "siyuan";
import { mount, unmount } from "svelte";
import LinkPanel from "@/components/LinkPanel.svelte";
import SettingsPanel from "@/components/SettingsPanel.svelte";
import { svelteDialog } from "@/libs/dialog";
import {
    DEFAULT_SETTINGS,
    linkSettings,
    linkState,
    type LinkItem,
    type LinkKind,
    type LinkScope,
    type LinkSettings,
} from "@/state.svelte";
import "./index.scss";

interface RefRow {
    refID?: string;
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
}

interface TitleRow {
    id?: string;
    content?: string;
    hpath?: string;
}

const DOCK_TYPE = "link-explorer";
const ID_RE = /^[0-9a-z-]{1,64}$/i;
const MAX_PER_LIST = 2000;
const MAX_MENTIONS = 50;

export default class LinkExplorer extends Plugin {
    private disposed = false;
    private refreshSeq = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private lastRootID = "";
    private lastBlockID = "";
    private panelApp: ReturnType<typeof mount> | null = null;
    private settingsDialog: ReturnType<typeof svelteDialog> | undefined;

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
                title: this.t("dockTitle", "Link Explorer"),
            },
            data: {},
            type: DOCK_TYPE,
            init() {
                const element = this.element;
                plugin.panelApp = mount(LinkPanel, {
                    target: element,
                    props: {
                        labels: plugin.labels(),
                        onRefresh: () => void plugin.refresh(),
                        onOpen: (item: LinkItem) => plugin.openItem(item),
                        onContextMenu: (event: MouseEvent, item: LinkItem) => plugin.showItemMenu(event, item),
                        onSettingsChange: (next: LinkSettings) => plugin.applySettings(next),
                        onOpenSettings: () => plugin.openSettings(),
                        onScopeChange: (scope: LinkScope) => plugin.setScope(scope),
                    },
                });
            },
            destroy() {
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
        this.eventBus.off("switch-protyle", this.onProtyleEvent);
        this.eventBus.off("loaded-protyle-static", this.onProtyleEvent);
        this.eventBus.off("destroy-protyle", this.onProtyleDestroy);
        this.eventBus.off("ws-main", this.onWs);
        document.removeEventListener("selectionchange", this.onSelectionChange, true);
        this.settingsDialog?.close();
        this.settingsDialog = undefined;
        if (this.panelApp) {
            unmount(this.panelApp);
            this.panelApp = null;
        }
        this.resetState();
    }

    private t(key: string, fallback: string): string {
        const value = (this.i18n as Record<string, unknown>)[key];
        return typeof value === "string" && value ? value : fallback;
    }

    private labels(): Record<string, string> {
        const keys = [
            "dockTitle", "refresh", "settings", "loading", "noDoc", "error",
            "untitled", "thisDoc", "scopeDoc", "scopeBlock", "needBlock", "jumpTo",
            "outgoing", "backlinks", "mentions", "externalLinks", "assets", "deadLinks",
            "emptyOutgoing", "emptyBacklinks", "emptyMentions", "emptyExternal",
            "emptyAssets", "emptyDead", "outgoingFlow", "backlinkFlow", "deadFlow",
            "isolated", "searchPlaceholder", "excludeDaily", "excludeSelf", "onlyNotebook",
            "reference", "embed", "mention", "external", "asset", "deadTarget",
            "mentionContext", "internalLink", "openFailed",
            "copyReference", "copyLink", "openLink", "openAsset", "openInNewTab",
            "openInSplitRight", "openInSplitBottom", "openSourceDoc", "openTargetDoc",
            "copied", "copyFailed",
            "settingsTitle", "settingsSections", "settingsBehavior", "settingsFilters",
            "showMentions", "showExternal", "showAssets", "showDead",
            "groupByDoc", "autoRefresh", "maxItems", "maxItemsHint", "save", "cancel",
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
        if (rootID) {
            if (rootID !== this.lastRootID) this.lastBlockID = "";
            this.lastRootID = rootID;
            this.scheduleRefresh(true);
        }
    };

    private onProtyleDestroy = (event: any) => {
        if (this.disposed) return;
        const rootID = event?.detail?.protyle?.block?.rootID || "";
        if (rootID && rootID === this.lastRootID) {
            this.lastRootID = "";
            this.lastBlockID = "";
            this.scheduleRefresh(true);
        }
    };

    private onWs = (event: any) => {
        if (this.disposed) return;
        if (event?.detail?.cmd !== "transactions") return;
        if (!linkSettings.autoRefresh) return;
        if (!this.currentRootID()) return;
        this.scheduleRefresh(false);
    };

    private scheduleRefresh(force: boolean) {
        if (this.disposed) return;
        if (!force && !linkSettings.autoRefresh) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.refresh();
        }, 700);
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
            this.resetState();
            return;
        }

        const notebookID = this.currentNotebookID();
        let scope = linkSettings.scope;
        let blockID = scope === "block" ? this.currentBlockID() : "";
        const seq = ++this.refreshSeq;

        if (scope === "block" && (!blockID || !ID_RE.test(blockID))) {
            scope = "doc";
            blockID = "";
            linkSettings.scope = "doc";
            linkState.scope = "doc";
            this.saveSettings();
        }

        linkState.loading = true;
        linkState.error = "";
        linkState.scope = scope;
        linkState.notebookID = notebookID;

        const subjectID = blockID || rootID;
        const max = Math.min(MAX_PER_LIST, Math.max(50, Math.round(Number(linkSettings.maxItems) || 500)));

        try {
            const titleRows = await this.post<TitleRow[]>("/api/query/sql", {
                stmt: `SELECT id, content, hpath FROM blocks WHERE id IN ('${rootID}'` +
                    (blockID ? `, '${blockID}'` : "") + `)`,
            });
            if (this.disposed || seq !== this.refreshSeq) return;
            const docRow = (titleRows || []).find((row) => row.id === rootID);
            const blockRow = blockID ? (titleRows || []).find((row) => row.id === blockID) : undefined;
            const docTitle = this.clip(docRow?.content, 200) || this.t("untitled", "Untitled");
            const blockTitle = this.clip(blockRow?.content, 200) || "";
            const docPath = String(docRow?.hpath || "");

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
                return;
            }

            linkState.docID = rootID;
            linkState.docTitle = docTitle;
            linkState.scopeBlockID = blockID;
            linkState.scopeBlockTitle = blockTitle;

            const [outgoingRows, backlinkRows, deadRows] = await Promise.all([
                this.post<RefRow[]>("/api/query/sql", { stmt: this.refsStmt(rootID, blockID, "outgoing", max) }),
                this.post<RefRow[]>("/api/query/sql", { stmt: this.refsStmt(rootID, blockID, "backlinks", max) }),
                this.post<RefRow[]>("/api/query/sql", { stmt: this.refsStmt(rootID, blockID, "dead", max) }),
            ]);
            if (this.disposed || seq !== this.refreshSeq) return;

            const outgoing = this.mapRefs(outgoingRows, "outgoing", docTitle);
            const backlinks = this.mapRefs(backlinkRows, "backlinks", docTitle);
            const dead = this.mapRefs(deadRows, "dead", docTitle);

            let mentions: LinkItem[] = [];
            if (scope === "doc" && linkSettings.showMentions) {
                try {
                    mentions = await this.loadMentions(rootID, notebookID, docTitle, docPath);
                } catch (error) {
                    console.warn("[siyuan-link-explorer] mentions failed", error);
                }
            }

            let external: LinkItem[] = [];
            let assets: LinkItem[] = [];
            if (linkSettings.showExternal || linkSettings.showAssets) {
                try {
                    const markdown = await this.loadMarkdown(subjectID, scope, rootID);
                    const parsed = this.parseMarkdown(markdown, {
                        sourceDocID: rootID,
                        sourceDocTitle: docTitle,
                        sourcePath: docPath,
                        sourceBox: notebookID,
                        targetDocID: "",
                        targetPath: "",
                        targetBox: "",
                        group: this.t("thisDoc", "This document"),
                        self: false,
                    });
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
                } catch (error) {
                    console.warn("[siyuan-link-explorer] markdown links failed", error);
                }
            }

            if (this.disposed || seq !== this.refreshSeq) return;
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
            }
        }
    }

    private refsStmt(rootID: string, blockID: string, mode: "outgoing" | "backlinks" | "dead", max: number): string {
        const where = mode === "outgoing"
            ? (blockID ? `r.block_id = '${blockID}'` : `r.root_id = '${rootID}'`)
            : mode === "backlinks"
                ? (blockID
                    ? `r.def_block_id = '${blockID}' AND tb.id IS NOT NULL`
                    : `(r.def_block_root_id = '${rootID}' OR r.def_block_id = '${rootID}') AND tb.id IS NOT NULL`)
                : (blockID
                    ? `(r.block_id = '${blockID}' OR r.def_block_id = '${blockID}') AND tb.id IS NULL`
                    : `(r.root_id = '${rootID}' OR r.def_block_root_id = '${rootID}' OR r.def_block_id = '${rootID}') AND tb.id IS NULL`);
        return `SELECT r.id AS refID, r.block_id AS sourceBlockID, r.root_id AS sourceDocID, ` +
            `r.def_block_id AS targetBlockID, r.def_block_root_id AS targetDocID, ` +
            `r.content AS anchor, r.markdown AS markdown, ` +
            `sb.content AS sourceText, tb.content AS targetText, ` +
            `sd.content AS sourceDocTitle, td.content AS targetDocTitle, ` +
            `sd.hpath AS sourcePath, td.hpath AS targetPath, ` +
            `sd.box AS sourceBox, td.box AS targetBox ` +
            `FROM refs r ` +
            `LEFT JOIN blocks sb ON sb.id = r.block_id ` +
            `LEFT JOIN blocks tb ON tb.id = r.def_block_id ` +
            `LEFT JOIN blocks sd ON sd.id = r.root_id ` +
            `LEFT JOIN blocks td ON td.id = r.def_block_root_id ` +
            `WHERE ${where} ORDER BY r.block_id, r.def_block_id LIMIT ${max}`;
    }

    private mapRefs(rows: RefRow[], mode: "outgoing" | "backlinks" | "dead", docTitle: string): LinkItem[] {
        const items: LinkItem[] = [];
        for (const row of rows) {
            const sourceDocID = String(row.sourceDocID || "");
            const targetDocID = String(row.targetDocID || "");
            const sourceBox = String(row.sourceBox || "");
            const targetBox = String(row.targetBox || "");
            const sourcePath = String(row.sourcePath || "");
            const targetPath = String(row.targetPath || "");
            const anchor = this.clip(row.anchor, 200);
            const sourceText = this.clip(row.sourceText, 260);
            const targetText = this.clip(row.targetText, 260);
            const sourceDocTitle = this.clip(row.sourceDocTitle, 200);
            const targetDocTitle = this.clip(row.targetDocTitle, 200);
            const self = Boolean(sourceDocID && targetDocID && sourceDocID === targetDocID);
            const kind: LinkKind = this.isEmbed(row.markdown) ? "embed" : "reference";

            if (mode === "outgoing") {
                const id = String(row.targetBlockID || "");
                if (!id) continue;
                const title = targetDocTitle || targetText || anchor || this.t("untitled", "Untitled");
                items.push({
                    id,
                    title,
                    context: sourceText || anchor,
                    fullContext: this.full(row.sourceText || row.anchor || row.targetText),
                    meta: anchor && anchor !== title ? anchor : (targetText && targetText !== title ? targetText : ""),
                    kind,
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
                items.push({
                    id,
                    title: this.t("deadTarget", "Target is missing"),
                    context: sourceText || anchor,
                    fullContext: this.full(sourceText || anchor || targetText),
                    meta: anchor || String(row.targetBlockID || ""),
                    kind: "dead",
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
            items.push({
                id,
                title: sourceDocTitle || sourceText || anchor || this.t("untitled", "Untitled"),
                context: sourceText || anchor,
                fullContext: this.full(row.sourceText || row.anchor || row.targetText),
                meta: anchor || targetText,
                kind,
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

    private async loadMentions(rootID: string, notebookID: string, docTitle: string, docPath: string): Promise<LinkItem[]> {
        const response = await fetchSyncPost("/api/ref/getBacklink2", {
            id: rootID,
            k: "",
            mk: "",
            includeBacklinks: false,
            includeMentions: true,
        });
        if (!response || response.code !== 0) return [];
        const paths = Array.isArray(response.data?.backmentions) ? response.data.backmentions : [];
        const items: LinkItem[] = [];
        const title = String(docTitle || "").replace(/'/g, "''");
        for (const path of paths.slice(0, MAX_MENTIONS)) {
            const sourceDocID = String(path?.id || "");
            if (!sourceDocID || !ID_RE.test(sourceDocID)) continue;
            let blockID = sourceDocID;
            let context = this.t("mentionContext", "Mentioned in the document body");
            if (title && title !== this.t("untitled", "Untitled")) {
                try {
                    const rows = await this.post<Array<{ id?: string; content?: string }>>("/api/query/sql", {
                        stmt: `SELECT id, content FROM blocks WHERE root_id = '${sourceDocID}' AND instr(content, '${title}') > 0 LIMIT 1`,
                    });
                    if (rows?.[0]?.id) {
                        blockID = rows[0].id;
                        context = this.clip(rows[0].content, 260) || context;
                    }
                } catch (error) {
                    // keep the document-level fallback
                }
            }
            const sourceDocTitle = this.clip(path?.name, 200) || this.t("untitled", "Untitled");
            items.push({
                id: blockID,
                title: sourceDocTitle,
                context,
                fullContext: this.full(context),
                meta: docTitle,
                kind: "mention",
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

    private parseMarkdown(
        markdown: string,
        base: {
            sourceDocID: string;
            sourceDocTitle: string;
            sourcePath: string;
            sourceBox: string;
            targetDocID: string;
            targetPath: string;
            targetBox: string;
            group: string;
            self: boolean;
        },
    ): { external: LinkItem[]; assets: LinkItem[]; internal: LinkItem[] } {
        const external: LinkItem[] = [];
        const assets: LinkItem[] = [];
        const internal: LinkItem[] = [];
        const seen = new Set<string>();
        const text = String(markdown || "");

        const push = (rawUrl: string, label: string, isImage: boolean) => {
            const url = this.decodeEntities(String(rawUrl || "").trim());
            if (!url || url.startsWith("#") || /^(javascript|data:text)/i.test(url)) return;
            const linkText = this.clip(this.decodeEntities(this.stripHtml(label)), 160);

            if (/^siyuan:\/\/blocks?\//i.test(url)) {
                const id = url.replace(/^siyuan:\/\/blocks?\//i, "").split(/[?#]/)[0];
                if (!ID_RE.test(id) || seen.has("i:" + id)) return;
                seen.add("i:" + id);
                internal.push({
                    id,
                    title: linkText || id,
                    context: this.t("internalLink", "Internal link"),
                    fullContext: linkText || url,
                    meta: url,
                    kind: "reference",
                    group: base.group,
                    sourceDocID: base.sourceDocID,
                    targetDocID: "",
                    sourcePath: base.sourcePath,
                    targetPath: "",
                    sourceBox: base.sourceBox,
                    targetBox: "",
                    self: false,
                });
                return;
            }

            if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) {
                if (seen.has("e:" + url)) return;
                seen.add("e:" + url);
                external.push({
                    id: url,
                    title: linkText || url,
                    context: url,
                    fullContext: url,
                    meta: this.domainOf(url),
                    kind: "external",
                    group: base.group,
                    sourceDocID: base.sourceDocID,
                    targetDocID: base.targetDocID,
                    sourcePath: base.sourcePath,
                    targetPath: base.targetPath,
                    sourceBox: base.sourceBox,
                    targetBox: base.targetBox,
                    self: base.self,
                    url,
                });
                return;
            }

            if (url.startsWith("assets/") ||
                (/\.(png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|zip|mp3|mp4|wav)(\?|#|$)/i.test(url) && !/^[a-z]+:/i.test(url))) {
                if (seen.has("a:" + url)) return;
                seen.add("a:" + url);
                assets.push({
                    id: url,
                    title: linkText || this.basename(url) || (isImage ? this.t("asset", "Asset") : url),
                    context: url,
                    fullContext: url,
                    meta: this.t("asset", "Asset"),
                    kind: "asset",
                    group: base.group,
                    sourceDocID: base.sourceDocID,
                    targetDocID: base.targetDocID,
                    sourcePath: base.sourcePath,
                    targetPath: base.targetPath,
                    sourceBox: base.sourceBox,
                    targetBox: base.targetBox,
                    self: base.self,
                    url,
                });
            }
        };

        for (const match of text.matchAll(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g)) {
            push(match[2], match[1], true);
        }
        for (const match of text.matchAll(/(?<!!)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g)) {
            push(match[2], match[1], false);
        }
        for (const match of text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
            push(match[1], match[2], false);
        }
        for (const match of text.matchAll(/<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
            push(match[1], "", true);
        }
        return { external, assets, internal };
    }

    private isEmbed(markdown: unknown): boolean {
        return String(markdown || "").trimStart().startsWith("!");
    }

    private clip(value: unknown, max = 260): string {
        const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
        if (!text) return "";
        return text.length > max ? text.slice(0, max) + "…" : text;
    }

    private full(value: unknown): string {
        const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
        return text.length > 1500 ? text.slice(0, 1500) + "…" : text;
    }

    private stripHtml(value: string): string {
        return String(value || "").replace(/<[^>]*>/g, "");
    }

    private decodeEntities(value: string): string {
        return String(value || "")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, "\"")
            .replace(/&#39;/gi, "'");
    }

    private basename(path: string): string {
        const clean = String(path || "").split(/[?#]/)[0];
        return clean.split("/").pop() || clean;
    }

    private domainOf(url: string): string {
        try {
            const parsed = new URL(url);
            return parsed.hostname || parsed.protocol.replace(":", "");
        } catch (error) {
            return String(url).split(":")[0] || "";
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
        ] as const) {
            if (typeof raw[key] === "boolean") settings[key] = raw[key];
        }
        const max = Number(raw.maxItems);
        if (Number.isFinite(max)) settings.maxItems = Math.min(MAX_PER_LIST, Math.max(50, Math.round(max)));
        if (raw.scope === "block") settings.scope = "block";
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
            title: this.t("settingsTitle", "Link Explorer settings"),
            component: SettingsPanel,
            width: "480px",
            height: "600px",
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
