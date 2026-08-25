import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "../dist/public");
const html = await readFile(path.join(dist, "index.html"), "utf8");
const entry = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];

if (!entry) throw new Error("Entry module not found in dist/public/index.html");

const entryPath = path.join(dist, entry.replace(/^\//, ""));
const bytes = (await stat(entryPath)).size;
const gzipBytes = gzipSync(await readFile(entryPath)).byteLength;
const maxGzipBytes = 400 * 1024;

console.log(
  `Initial entry ${path.basename(entryPath)}: ${(bytes / 1024).toFixed(1)} KiB, ${(gzipBytes / 1024).toFixed(1)} KiB gzip`,
);

if (gzipBytes > maxGzipBytes) {
  throw new Error(
    `Initial entry exceeds the ${(maxGzipBytes / 1024).toFixed(0)} KiB gzip budget`,
  );
}
