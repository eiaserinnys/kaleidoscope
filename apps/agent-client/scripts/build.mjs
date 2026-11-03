import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = resolve(root, "../assets");
const target = resolve(assets, "agent/client.js");
const manifestPath = resolve(assets, "manifest.json");
const check = process.argv.includes("--check");
if (!check) execFileSync("npm", ["test"], { cwd: root, stdio: "inherit" });
const bundle = await build({ entryPoints: [resolve(root, "src/index.ts")], bundle: true, write: false, format: "iife", globalName: "KaleidoscopeAgentClient", platform: "browser", target: "es2022", minify: true, legalComments: "none" });
const bytes = bundle.outputFiles[0].contents;
const hash = createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entry = { id: "builtin-agent-client", version: 1, format: "javascript", sha256: hash, source: "apps/agent-client", license: "MIT", byte_size: bytes.length, created_at: "2026-11-03T00:00:00Z", path: "agent/client.js" };
const index = manifest.findIndex((item) => item.id === entry.id && item.version === entry.version);
if (check) {
  const saved = await readFile(target);
  if (!saved.equals(Buffer.from(bytes)) || index < 0 || JSON.stringify(manifest[index]) !== JSON.stringify(entry)) throw new Error("에이전트 client 번들과 자산 목록이 일치하지 않습니다");
} else {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  if (index < 0) manifest.push(entry); else manifest[index] = entry;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`에이전트 client: ${bytes.length} bytes, SHA-256 ${hash}`);
