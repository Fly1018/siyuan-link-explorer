import assert from "node:assert/strict";
import test from "node:test";
import {
    deadDocsStmt,
    deadRefCountStmt,
    docCountStmt,
    refsStmt,
    topIncomingStmt,
    topOutgoingStmt,
} from "../.test-dist/sql.js";

const ROOT = "20261025120000-root001";
const BLOCK = "20261025120000-block01";
const BOX = "20261025114751-749pv85";

test("refsStmt groups before limiting and counts occurrences", () => {
    const sql = refsStmt(ROOT, "", "outgoing", 500);
    assert.match(sql, /GROUP BY r\.block_id, r\.def_block_id/);
    assert.match(sql, /COUNT\(\*\) AS refCount/);
    assert.match(sql, /LIMIT 500/);
    assert.match(sql, /r\.root_id = '20261025120000-root001'/);
    assert.ok(sql.indexOf("GROUP BY") < sql.indexOf("LIMIT"));
});

test("refsStmt switches scope and mode", () => {
    assert.match(refsStmt(ROOT, BLOCK, "outgoing", 50), /r\.block_id = '20261025120000-block01'/);
    assert.match(refsStmt(ROOT, BLOCK, "backlinks", 50), /r\.def_block_id = '20261025120000-block01'/);
    const dead = refsStmt(ROOT, "", "dead", 50);
    assert.match(dead, /tb\.id IS NULL/);
    assert.match(dead, /r\.def_block_root_id = '20261025120000-root001'/);
});

test("health queries target the notebook and cap the list size", () => {
    assert.match(docCountStmt(BOX), /box = '20261025114751-749pv85'/);
    assert.match(deadRefCountStmt(BOX), /tb\.id IS NULL/);
    const deadDocs = deadDocsStmt(BOX, 5);
    assert.match(deadDocs, /GROUP BY r\.root_id/);
    assert.match(deadDocs, /LIMIT 5/);
    assert.match(topOutgoingStmt(BOX, 5), /JOIN blocks tb/);
    assert.match(topIncomingStmt(BOX, 5), /r\.def_block_root_id/);
});
