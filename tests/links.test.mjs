import assert from "node:assert/strict";
import test from "node:test";
import {
    assetKindOf,
    clip,
    countOccurrences,
    domainOf,
    fullText,
    isAssetUrl,
    parseMarkdown,
} from "../.test-dist/links.js";

const t = (key, fallback) => ({ assetImage: "图片", assetVideo: "视频", assetAudio: "音频", assetPdf: "PDF", assetDocument: "文档", assetArchive: "压缩包", assetOther: "其他" }[key] || fallback);

const base = {
    sourceDocID: "20261025120000-source1",
    sourceDocTitle: "源文档",
    sourcePath: "/源文档",
    sourceBox: "box1",
    targetDocID: "",
    targetPath: "",
    targetBox: "",
    group: "本文档",
    self: false,
};

test("assetKindOf classifies by extension and ignores query strings", () => {
    assert.equal(assetKindOf("assets/a.PNG?x=1"), "image");
    assert.equal(assetKindOf("assets/a.mp4"), "video");
    assert.equal(assetKindOf("assets/a.mp3#t=3"), "audio");
    assert.equal(assetKindOf("assets/a.pdf"), "pdf");
    assert.equal(assetKindOf("assets/a.xlsx"), "document");
    assert.equal(assetKindOf("assets/a.zip"), "archive");
    assert.equal(assetKindOf("assets/a.bin"), "other");
});

test("isAssetUrl accepts assets/ and known extensions but not web URLs", () => {
    assert.equal(isAssetUrl("assets/anything.bin"), true);
    assert.equal(isAssetUrl("files/movie.MP4"), true);
    assert.equal(isAssetUrl("https://example.com/a.png"), false);
    assert.equal(isAssetUrl("siyuan://blocks/20261025120000-block1"), false);
});

test("parseMarkdown keeps balanced parentheses in URLs", () => {
    const { external } = parseMarkdown("[示例](https://example.com/wiki/Foo_(bar))", base, t);
    assert.equal(external.length, 1);
    assert.equal(external[0].url, "https://example.com/wiki/Foo_(bar)");
    assert.equal(external[0].group, "example.com");
});

test("parseMarkdown ignores links in code, inline code and comments", () => {
    const md = [
        "```",
        "[代码](assets/code.png)",
        "```",
        "`[行内](assets/inline.png)`",
        "<!-- [注释](assets/comment.png) -->",
        "[真实](assets/real.png)",
    ].join("\n");
    const { assets, external } = parseMarkdown(md, base, t);
    assert.deepEqual(assets.map((item) => item.id), ["assets/real.png"]);
    assert.equal(external.length, 0);
});

test("parseMarkdown reads SiYuan video/audio HTML tags", () => {
    const md = [
        '<video controls="controls" src="assets/movie.mp4" data-src="assets/movie.mp4"></video>',
        '<audio controls="controls" src="assets/song.mp3" data-src="assets/song.mp3"></audio>',
    ].join("\n");
    const { assets } = parseMarkdown(md, base, t);
    assert.deepEqual(assets.map((item) => item.assetKind), ["video", "audio"]);
    assert.deepEqual(assets.map((item) => item.group), ["视频", "音频"]);
});

test("parseMarkdown groups assets by type and external links by domain", () => {
    const md = [
        "![图](assets/a.png)",
        "[表](assets/a.xlsx)",
        "[外链](https://docs.example.com/x)",
        "[另一条](https://docs.example.com/y)",
    ].join("\n");
    const { assets, external } = parseMarkdown(md, base, t);
    assert.deepEqual(assets.map((item) => item.group), ["图片", "文档"]);
    assert.deepEqual(external.map((item) => item.group), ["docs.example.com", "docs.example.com"]);
});

test("parseMarkdown turns siyuan block links into internal references", () => {
    const { internal, external } = parseMarkdown("[引用](siyuan://blocks/20261025120000-target1)", base, t);
    assert.equal(external.length, 0);
    assert.equal(internal.length, 1);
    assert.equal(internal[0].id, "20261025120000-target1");
    assert.equal(internal[0].kind, "reference");
});

test("parseMarkdown skips javascript and data URLs and dedupes", () => {
    const md = [
        "[x](javascript:alert(1))",
        "![x](data:text/html;base64,abc)",
        "[a](https://example.com/a)",
        "[b](https://example.com/a)",
    ].join("\n");
    const { external, assets } = parseMarkdown(md, base, t);
    assert.equal(assets.length, 0);
    assert.deepEqual(external.map((item) => item.id), ["https://example.com/a"]);
});

test("domainOf and clip handle edge cases", () => {
    assert.equal(domainOf("mailto:a@example.com"), "mailto");
    assert.equal(domainOf("https://example.com/x"), "example.com");
    assert.equal(clip(" a \n b ", 3), "a b");
    assert.equal(clip("abcdef", 3), "abc…");
    assert.equal(fullText("  a  b  "), "a b");
});

test("countOccurrences counts repeated block references", () => {
    const id = "20261025120000-target1";
    const md = `(( ${id} "a" )) and (( ${id} "b" )) and (( ${id} "c" ))`;
    assert.equal(countOccurrences(md, id), 3);
    assert.equal(countOccurrences(md, "missing"), 0);
    assert.equal(countOccurrences(md, ""), 0);
});
