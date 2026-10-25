import type { AssetKind, LinkItem, LinkKind } from "@/logic/links";

export type { AssetKind, LinkItem, LinkKind };

export type LinkScope = "doc" | "block";
export type SortMode = "default" | "title" | "updated";

export interface LinkSettings {
    showMentions: boolean;
    showExternal: boolean;
    showAssets: boolean;
    showDead: boolean;
    groupByDoc: boolean;
    autoRefresh: boolean;
    maxItems: number;
    excludeDaily: boolean;
    excludeSelf: boolean;
    onlyNotebook: boolean;
    scope: LinkScope;
    fontSize: number;
    hoverPreview: boolean;
    hideEmptySections: boolean;
    sortMode: SortMode;
}

export const DEFAULT_SETTINGS: LinkSettings = {
    showMentions: true,
    showExternal: true,
    showAssets: true,
    showDead: true,
    groupByDoc: true,
    autoRefresh: true,
    maxItems: 500,
    excludeDaily: false,
    excludeSelf: false,
    onlyNotebook: false,
    scope: "doc",
    fontSize: 13,
    hoverPreview: true,
    hideEmptySections: false,
    sortMode: "default",
};

export const linkSettings = $state<LinkSettings>({ ...DEFAULT_SETTINGS });

export interface IsolatedDoc {
    id: string;
    title: string;
    hpath: string;
}

export interface HealthDoc {
    id: string;
    title: string;
    hpath: string;
    count: number;
}

export interface MissingAsset {
    path: string;
    name?: string;
}

export interface HealthData {
    docs: number;
    deadRefs: number;
    deadDocs: HealthDoc[];
    topOutgoing: HealthDoc[];
    topIncoming: HealthDoc[];
    missingAssets: MissingAsset[];
}

/** Only the most recently updated documents are scanned for the orphan list. */
export const ISOLATED_MAX = 80;

export const linkState = $state({
    docID: "",
    docTitle: "",
    notebookID: "",
    scope: "doc" as LinkScope,
    scopeBlockID: "",
    scopeBlockTitle: "",
    loading: false,
    error: "",
    outgoing: [] as LinkItem[],
    backlinks: [] as LinkItem[],
    mentions: [] as LinkItem[],
    external: [] as LinkItem[],
    assets: [] as LinkItem[],
    dead: [] as LinkItem[],
    isolatedActive: false,
    isolatedLoading: false,
    isolatedError: "",
    isolatedDocs: [] as IsolatedDoc[],
    isolatedHasMore: false,
    healthActive: false,
    healthLoading: false,
    healthError: "",
    healthData: null as HealthData | null,
});
