import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function fail(message) {
    console.error(`verify: ${message}`);
    process.exit(1);
}

if (manifest.name !== pkg.name) fail(`plugin.json name (${manifest.name}) !== package.json name (${pkg.name})`);

function pngSize(file) {
    const data = readFileSync(join(root, file));
    const signature = "89504e470d0a1a0a";
    if (data.subarray(0, 8).toString("hex") !== signature) fail(`${file} is not a PNG`);
    return { bytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function checkImage(field, maxBytes, width, height) {
    const file = manifest[field];
    if (typeof file !== "string" || !file) fail(`plugin.json is missing "${field}"`);
    if (!existsSync(join(root, file))) fail(`${field} file not found: ${file}`);
    const info = pngSize(file);
    if (info.bytes > maxBytes) fail(`${file} is ${info.bytes} bytes (limit ${maxBytes})`);
    if (info.width !== width || info.height !== height) {
        fail(`${file} is ${info.width}x${info.height} (expected ${width}x${height})`);
    }
    console.log(`verify: ${file} ${info.width}x${info.height}, ${info.bytes} bytes`);
}

checkImage("icon", 64 * 1024, 160, 160);
checkImage("preview", 512 * 1024, 1024, 768);

const zip = join(root, "package.zip");
if (existsSync(zip)) {
    const data = readFileSync(zip);
    let offset = 0;
    let count = 0;
    while (offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50) {
        const nameLength = data.readUInt16LE(offset + 26);
        const extraLength = data.readUInt16LE(offset + 28);
        const compressed = data.readUInt32LE(offset + 18);
        const name = data.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
        if (name.includes("\\")) fail(`package.zip entry uses backslashes: ${name}`);
        offset += 30 + nameLength + extraLength + compressed;
        count += 1;
    }
    if (!count) fail("package.zip has no entries");
    for (const required of ["index.js", "index.css", "plugin.json", "icon.png", "preview.png"]) {
        const found = data.includes(Buffer.from(required));
        if (!found) fail(`package.zip is missing ${required}`);
    }
    console.log(`verify: package.zip has ${count} entries with forward-slash paths`);
}
