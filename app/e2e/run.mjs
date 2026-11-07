import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const e2eDir = path.join(appDir, "e2e");
const fixturesDir = path.join(e2eDir, "fixtures", "documents");
const resultsRoot = path.join(appDir, "test-results");
const playwrightBin = path.join(appDir, "node_modules", ".bin", process.platform === "win32" ? "playwright.cmd" : "playwright");

const { coreUrl, devbridgeBinary, pathsFor, uiPort } = await import("./runtime.ts");

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: appDir, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function selectedSpecs() {
  const names = await readdir(e2eDir);
  const specs = names.filter((name) => name.endsWith(".spec.ts")).sort();
  const argv = process.argv.slice(2);
  const requested = argv[0] === "--" ? argv.slice(1) : argv;
  if (requested.length === 0) return specs;
  return [...new Set(requested)].map((argument) => {
    const name = path.basename(argument);
    const spec = specs.find((file) => file === name);
    if (!spec) {
      console.error(`[app-e2e] 알 수 없는 시험 파일입니다: ${argument}`);
      console.error(`[app-e2e] 사용할 수 있는 파일: ${specs.join(", ")}`);
      process.exit(2);
    }
    return spec;
  });
}

// spawn 전에 stdout/stderr를 로그 파일과 터미널에 함께 남긴다.
function runSpec(spec, paths) {
  return new Promise((resolve) => {
    const log = createWriteStream(path.join(paths.root, "playwright.log"), { flags: "w" });
    log.write(`# spec: ${spec}\n`);
    log.write(`# runtime: ${paths.root}\n`);
    log.write(`# command: playwright test --config e2e/playwright.config.ts e2e/${spec}\n`);
    const child = spawn(playwrightBin, ["test", "--config", "e2e/playwright.config.ts", `e2e/${spec}`], {
      cwd: appDir,
      env: { ...process.env, KS_E2E_RUNTIME_DIR: paths.root },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      log.end(() => resolve(code));
    };
    child.stdout.on("data", (chunk) => { process.stdout.write(chunk); log.write(chunk); });
    child.stderr.on("data", (chunk) => { process.stderr.write(chunk); log.write(chunk); });
    child.on("error", (error) => {
      const line = `[app-e2e] ${spec}: 실행할 수 없습니다: ${error.message}\n`;
      process.stderr.write(line);
      log.write(line);
      finish(1);
    });
    child.on("close", (code, signal) => finish(code ?? (signal ? 1 : 0)));
  });
}

async function readReport(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

const specs = await selectedSpecs();
if (specs.length === 0) {
  console.error("[app-e2e] 실행할 시험 파일이 없습니다.");
  process.exit(1);
}

const startedAt = new Date();
const sha = gitSha();
console.log(`[app-e2e] 시작 ${startedAt.toISOString()} SHA ${sha}`);
console.log(`[app-e2e] UI http://localhost:${uiPort}, core ${coreUrl}`);
console.log(`[app-e2e] devbridge ${devbridgeBinary()}`);
console.log(`[app-e2e] 파일 ${specs.length}개: ${specs.join(", ")}`);

await rm(resultsRoot, { recursive: true, force: true });
await mkdir(resultsRoot, { recursive: true });

const totals = { passed: 0, failed: 0, skipped: 0, flaky: 0, files: 0, missing: 0 };
let failedRuns = 0;

for (const spec of specs) {
  const name = spec.slice(0, -".spec.ts".length);
  const paths = pathsFor(path.join(resultsRoot, name));
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });
  await cp(fixturesDir, paths.docsDir, { recursive: true });

  console.log(`[app-e2e] ${spec} 시작 (runtime ${paths.root})`);
  const fileStartedAt = Date.now();
  const exitCode = await runSpec(spec, paths);
  const report = await readReport(paths.reportFile);
  const stats = report?.stats;
  const passed = stats?.expected ?? 0;
  const failed = stats?.unexpected ?? 0;
  const skipped = stats?.skipped ?? 0;
  const flaky = stats?.flaky ?? 0;
  const total = passed + failed + skipped + flaky;
  const seconds = ((Date.now() - fileStartedAt) / 1000).toFixed(1);

  totals.files += 1;
  totals.passed += passed;
  totals.failed += failed;
  totals.skipped += skipped;
  totals.flaky += flaky;

  let problem = "";
  if (exitCode !== 0) problem += ` exit=${exitCode}`;
  if (!report) {
    totals.missing += 1;
    problem += " 보고서 없음";
  } else if (total === 0) {
    totals.missing += 1;
    problem += " 시험 0개";
  }
  if (failed > 0 || flaky > 0 || exitCode !== 0 || !report || total === 0) failedRuns += 1;

  console.log(
    `[app-e2e] ${spec}: ${passed} passed, ${failed} failed, ${skipped} skipped, ${flaky} flaky (${seconds}s)${problem ? ` [${problem.trim()}]` : ""}`,
  );
}

const duration = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
console.log(
  `[app-e2e] 합계: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped, ${totals.flaky} flaky, ${totals.missing} missing (${totals.files} files, ${duration}s)`,
);
console.log(`[app-e2e] 종료 SHA ${gitSha()}`);

if (failedRuns > 0) process.exitCode = 1;
