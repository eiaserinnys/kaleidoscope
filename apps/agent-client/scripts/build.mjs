import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBundle, checkPreserved } from "./bundle-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = resolve(root, "../assets");
const target = resolve(assets, "agent/client-v9.js");
const manifestPath = resolve(assets, "manifest.json");
const check = process.argv.includes("--check");
if (!check) execFileSync("npm", ["test"], { cwd: root, stdio: "inherit" });
const agentDefinition = JSON.parse(await readFile(resolve(root, "../agent.json"), "utf8"));
const defaults = agentDefinition.storage.entries.find((entry) => entry.id === "agents").default;
const bundle = await build({ entryPoints: [resolve(root, "src/index.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", minify: true, charset: "utf8", legalComments: "none", define: { __DEFAULT_AGENTS__: JSON.stringify(defaults) } });
const bytes = bundle.outputFiles[0].contents;
const hash = createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entry = { id: "builtin-agent-client", version: 9, format: "javascript", sha256: hash, source: "apps/agent-client", license: "MIT", byte_size: bytes.length, created_at: "2026-11-07T00:00:00Z", path: "agent/client-v9.js" };
const preserved = { id: "builtin-agent-client", version: 8, format: "javascript", sha256: "3ea37795f63037040875b70cfbf434b25812df3d6533a1b86788c5ca4472a09f", source: "apps/agent-client", license: "MIT", byte_size: 48046, created_at: "2026-11-06T00:00:00Z", path: "agent/client-v8.js" };
const oldBytes = await readFile(resolve(assets, preserved.path));
checkPreserved(oldBytes, manifest.find((item) => item.id === preserved.id && item.version === preserved.version), preserved);
const index = manifest.findIndex((item) => item.id === entry.id && item.version === entry.version);
if (check) {
  const saved = await readFile(target);
  checkBundle(bytes, saved, manifest[index], entry);
} else {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  if (index < 0) manifest.push(entry); else manifest[index] = entry;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const savedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  checkBundle(bytes, await readFile(target), savedManifest.find((item) => item.id === entry.id && item.version === entry.version), entry);
}
console.log(`에이전트 client: ${bytes.length} bytes, SHA-256 ${hash}`);
