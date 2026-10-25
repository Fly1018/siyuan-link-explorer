/**
 * Pure link parsing and classification helpers.
 *
 * This module deliberately has no runtime imports so it can be unit-tested in
 * plain Node without SiYuan or Svelte.
 */

export type LinkKind = "reference" | "embed" | "mention" | "external" | "asset" | "dead";
export type AssetKind = "image" | "video" | "audio" | "pdf" | "document" | "archive" | "other";

export const ID_RE = /^[0-9a-z-]{1,64}$/i;

export const ASSET_KINDS: AssetKind[] = ["image", "video", "audio", "pdf", "document", "archive", "other"];

const ASSET_LABEL_KEY: Record<AssetKind, string> = {
    image: "assetImage",
    video: "assetVideo",
    audio: "assetAudio",
    pdf: "assetPdf",
    document: "assetDocument",
    archive: "assetArchive",
    other: "assetOther",
};

const ASSET_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff?|heic|heif|mp4|webm|mov|m4v|avi|mkv|wmv|flv|mpe?g|ogv|mp3|wav|flac|ogg|oga|m4a|aac|wma|opus|midi?|pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|csv|epub|zip|rar|7z|tar|gz|bz2|xz|tgz)(\?|#|$)/i;

export interface LinkItem {
    id: string;
    /** Stable identity for keyed rendering; two occurrences of the same link must not share it. */
    key: string;
    title: string;
    context: string;
    fullContext: string;
    meta: string;
    kind: LinkKind;
    assetKind?: AssetKind;
    /** The referenced asset file is missing from the workspace. */
    assetMissing?: boolean;
    /** Number of occurrences when the same source/target pair is referenced repeatedly. */
    count?: number;
    /** Source block that contains the reference, used to count repeated references. */
    sourceBlockID?: string;
    /** Referenced block ID, used together with sourceBlockID for occurrence counting. */
    refTargetID?: string;
    /** Target (outgoing) or source (backlinks) document update time, for sorting. */
    updated?: string;
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

export interface ParseBase {
    sourceDocID: string;
    sourceDocTitle: string;
    sourcePath: string;
    sourceBox: string;
    targetDocID: string;
    targetPath: string;
    targetBox: string;
    group: string;
    self: boolean;
}

export type Translate = (key: string, fallback: string) => string;

export function clip(value: unknown, max = 260): string {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? text.slice(0, max) + "…" : text;
}

export function fullText(value: unknown): string {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    return text.length > 1500 ? text.slice(0, 1500) + "…" : text;
}

export function stripHtml(value: string): string {
    return String(value || "").replace(/<[^>]*>/g, "");
}

export function decodeEntities(value: string): string {
    return String(value || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'");
}

export function basename(path: string): string {
    const clean = String(path || "").split(/[?#]/)[0];
    return clean.split("/").pop() || clean;
}

export function domainOf(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname || parsed.protocol.replace(":", "");
    } catch (error) {
        return String(url).split(":")[0] || "";
    }
}

export function assetKindOf(url: string): AssetKind {
    const ext = (String(url || "").split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
    if (/^(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff?|heic|heif)$/.test(ext)) return "image";
    if (/^(mp4|webm|mov|m4v|avi|mkv|wmv|flv|mpe?g|ogv)$/.test(ext)) return "video";
    if (/^(mp3|wav|flac|ogg|oga|m4a|aac|wma|opus|midi?)$/.test(ext)) return "audio";
    if (ext === "pdf") return "pdf";
    if (/^(docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|csv|epub)$/.test(ext)) return "document";
    if (/^(zip|rar|7z|tar|gz|bz2|xz|tgz)$/.test(ext)) return "archive";
    return "other";
}

export function assetLabel(kind: AssetKind, t: Translate): string {
    return t(ASSET_LABEL_KEY[kind], kind);
}

export function assetOrder(kind?: AssetKind): number {
    return ASSET_KINDS.indexOf(kind || "other");
}

export function isEmbed(markdown: unknown): boolean {
    return String(markdown || "").trimStart().startsWith("!");
}

export function isAssetUrl(url: string): boolean {
    return url.startsWith("assets/") || (ASSET_EXT_RE.test(url) && !/^[a-z]+:/i.test(url));
}

/** Count non-overlapping occurrences of a block ID inside kramdown. */
export function countOccurrences(text: string, needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let index = 0;
    while ((index = text.indexOf(needle, index)) !== -1) {
        count += 1;
        index += needle.length;
    }
    return count;
}

export function parseMarkdown(
    markdown: string,
    base: ParseBase,
    t: Translate,
): { external: LinkItem[]; assets: LinkItem[]; internal: LinkItem[] } {
    const external: LinkItem[] = [];
    const assets: LinkItem[] = [];
    const internal: LinkItem[] = [];
    const seen = new Set<string>();
    // Links inside code samples are not real links; drop code blocks and
    // inline code before looking for Markdown/HTML links.
    const text = String(markdown || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/~~~[\s\S]*?~~~/g, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/`[^`\n]*`/g, " ");

    const push = (rawUrl: string, label: string, isImage: boolean) => {
        const url = decodeEntities(String(rawUrl || "").trim())
            .replace(/^</, "")
            .replace(/>$/, "");
        if (!url || url.startsWith("#") || /^(javascript|data:text)/i.test(url)) return;
        const linkText = clip(decodeEntities(stripHtml(label)), 160);

        if (/^siyuan:\/\/blocks?\//i.test(url)) {
            const id = url.replace(/^siyuan:\/\/blocks?\//i, "").split(/[?#]/)[0];
            if (!ID_RE.test(id) || seen.has("i:" + id)) return;
            seen.add("i:" + id);
            internal.push({
                id,
                key: "internal:" + id,
                title: linkText || id,
                context: t("internalLink", "Internal link"),
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
                key: "external:" + url,
                title: linkText || url,
                context: url,
                fullContext: url,
                meta: domainOf(url),
                kind: "external",
                group: domainOf(url),
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

        if (isAssetUrl(url)) {
            if (seen.has("a:" + url)) return;
            seen.add("a:" + url);
            const assetKind = assetKindOf(url);
            assets.push({
                id: url,
                key: "asset:" + url,
                title: linkText || basename(url) || (isImage ? t("asset", "Asset") : url),
                context: url,
                fullContext: url,
                meta: "",
                kind: "asset",
                assetKind,
                group: assetLabel(assetKind, t),
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

    // One level of balanced parentheses is allowed so URLs like
    // https://example.com/wiki/Foo_(bar) are kept intact.
    const mdUrl = String.raw`(<[^>\n]+>|[^()\s]+(?:\([^()\s]*\)[^()\s]*)*)`;
    for (const match of text.matchAll(new RegExp(String.raw`!\[([^\]]*)\]\(\s*${mdUrl}(?:\s+["'][^"']*["'])?\s*\)`, "g"))) {
        push(match[2], match[1], true);
    }
    for (const match of text.matchAll(new RegExp(String.raw`(?<!!)\[([^\]]*)\]\(\s*${mdUrl}(?:\s+["'][^"']*["'])?\s*\)`, "g"))) {
        push(match[2], match[1], false);
    }
    for (const match of text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        push(match[1], match[2], false);
    }
    for (const match of text.matchAll(/<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        push(match[1], "", true);
    }
    // SiYuan exports audio and video as HTML tags, not Markdown links.
    for (const match of text.matchAll(/<(?:video|audio)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        push(match[1], "", false);
    }
    for (const match of text.matchAll(/<source\b[^>]*?\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        push(match[1], "", false);
    }
    return { external, assets, internal };
}
