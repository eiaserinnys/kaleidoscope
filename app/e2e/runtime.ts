import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

export const appDir = path.resolve(e2eDir, "..");
export const repoRoot = path.resolve(appDir, "..");

// UI 포트의 기본값은 여기 한 곳에만 둔다. 공유 노드에서는 KS_E2E_PORT로 세션 전용 값을 준다.
export const uiPort = Number(process.env.KS_E2E_PORT ?? 1420);
if (!Number.isInteger(uiPort) || uiPort < 1 || uiPort > 65534) {
  throw new Error(`KS_E2E_PORT가 올바르지 않습니다: ${process.env.KS_E2E_PORT}`);
}
export const corePort = uiPort + 1;
export const coreUrl = `http://127.0.0.1:${corePort}`;
export const uiOrigin = `http://localhost:${uiPort}`;

// 한 번의 실행에서 spec마다 새 runtime 폴더를 쓰고, 그 아래 경로를 여기서만 정의한다.
export function pathsFor(runtimeDir: string) {
  const root = path.resolve(runtimeDir);
  return {
    root,
    dataDir: path.join(root, "data"),
    docsDir: path.join(root, "docs"),
    artifactsDir: path.join(root, "artifacts"),
    reportFile: path.join(root, "report.json"),
    outputDir: path.join(root, "playwright-output"),
  };
}

export function requiredRuntimeDir(): string {
  const value = process.env.KS_E2E_RUNTIME_DIR;
  if (!value) {
    throw new Error(
      "KS_E2E_RUNTIME_DIR가 없습니다. `pnpm --dir app e2e`(app/e2e/run.mjs)로 실행하십시오.",
    );
  }
  return path.resolve(value);
}

export function devbridgeBinary(): string {
  const name = process.platform === "win32" ? "kaleidoscope-devbridge.exe" : "kaleidoscope-devbridge";
  return path.join(repoRoot, "target", "debug", name);
}
