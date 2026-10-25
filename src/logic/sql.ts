/** Pure SQL builders for the link queries and the notebook health view. */

export type RefMode = "outgoing" | "backlinks" | "dead";

export function refsStmt(rootID: string, blockID: string, mode: RefMode, max: number): string {
    const where = mode === "outgoing"
        ? (blockID ? `r.block_id = '${blockID}' AND tb.id IS NOT NULL` : `r.root_id = '${rootID}' AND tb.id IS NOT NULL`)
        : mode === "backlinks"
            ? (blockID
                ? `r.def_block_id = '${blockID}' AND tb.id IS NOT NULL`
                : `(r.def_block_root_id = '${rootID}' OR r.def_block_id = '${rootID}') AND tb.id IS NOT NULL`)
            : (blockID
                ? `(r.block_id = '${blockID}' OR r.def_block_id = '${blockID}') AND tb.id IS NULL`
                : `(r.root_id = '${rootID}' OR r.def_block_root_id = '${rootID}' OR r.def_block_id = '${rootID}') AND tb.id IS NULL`);
    // GROUP BY removes repeated occurrences of the same source/target pair before
    // LIMIT, so duplicates cannot crowd out other links; COUNT(*) keeps the count.
    return `SELECT r.block_id AS sourceBlockID, r.root_id AS sourceDocID, ` +
        `r.def_block_id AS targetBlockID, r.def_block_root_id AS targetDocID, ` +
        `r.content AS anchor, r.markdown AS markdown, ` +
        `sb.content AS sourceText, tb.content AS targetText, ` +
        `sd.content AS sourceDocTitle, td.content AS targetDocTitle, ` +
        `sd.hpath AS sourcePath, td.hpath AS targetPath, ` +
        `sd.box AS sourceBox, td.box AS targetBox, ` +
        `sd.updated AS sourceUpdated, td.updated AS targetUpdated, ` +
        `COUNT(*) AS refCount ` +
        `FROM refs r ` +
        `LEFT JOIN blocks sb ON sb.id = r.block_id ` +
        `LEFT JOIN blocks tb ON tb.id = r.def_block_id ` +
        `LEFT JOIN blocks sd ON sd.id = r.root_id ` +
        `LEFT JOIN blocks td ON td.id = r.def_block_root_id ` +
        `WHERE ${where} GROUP BY r.block_id, r.def_block_id ` +
        `ORDER BY r.block_id, r.def_block_id LIMIT ${max}`;
}

export function docCountStmt(notebookID: string): string {
    return `SELECT COUNT(*) AS count FROM blocks WHERE type = 'd' AND box = '${notebookID}'`;
}

export function deadRefCountStmt(notebookID: string): string {
    return `SELECT COUNT(*) AS count FROM refs r LEFT JOIN blocks tb ON tb.id = r.def_block_id ` +
        `WHERE r.box = '${notebookID}' AND tb.id IS NULL`;
}

export function deadDocsStmt(notebookID: string, limit: number): string {
    return `SELECT r.root_id AS id, sd.content AS title, sd.hpath AS hpath, COUNT(*) AS count ` +
        `FROM refs r LEFT JOIN blocks tb ON tb.id = r.def_block_id ` +
        `LEFT JOIN blocks sd ON sd.id = r.root_id ` +
        `WHERE r.box = '${notebookID}' AND tb.id IS NULL AND r.root_id <> '' ` +
        `GROUP BY r.root_id ORDER BY count DESC, sd.hpath LIMIT ${limit}`;
}

export function topOutgoingStmt(notebookID: string, limit: number): string {
    return `SELECT r.root_id AS id, sd.content AS title, sd.hpath AS hpath, COUNT(*) AS count ` +
        `FROM refs r JOIN blocks tb ON tb.id = r.def_block_id JOIN blocks sd ON sd.id = r.root_id ` +
        `WHERE r.box = '${notebookID}' AND r.root_id <> '' ` +
        `GROUP BY r.root_id ORDER BY count DESC, sd.hpath LIMIT ${limit}`;
}

export function topIncomingStmt(notebookID: string, limit: number): string {
    // Count references from any notebook into this one.
    return `SELECT r.def_block_root_id AS id, td.content AS title, td.hpath AS hpath, COUNT(*) AS count ` +
        `FROM refs r JOIN blocks tb ON tb.id = r.def_block_id JOIN blocks td ON td.id = r.def_block_root_id ` +
        `WHERE td.box = '${notebookID}' AND r.def_block_root_id <> '' ` +
        `GROUP BY r.def_block_root_id ORDER BY count DESC, td.hpath LIMIT ${limit}`;
}
