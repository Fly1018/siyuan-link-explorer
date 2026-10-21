export type LinkKind = "reference" | "embed" | "mention" | "external" | "asset" | "dead";
export type LinkScope = "doc" | "block";

export interface LinkItem {
    id: string;
    title: string;
    context: string;
    fullContext: string;
    meta: string;
    kind: LinkKind;
    group: string;
    sourceDocID: string;
    targetDocID: string;
    sourcePath: string;
    targetPath: string;
    sourceBox: string;
    targetBox: string;
    self: boolean;
    url?: string;
}

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
};

export const linkSettings = $state<LinkSettings>({ ...DEFAULT_SETTINGS });

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
});
