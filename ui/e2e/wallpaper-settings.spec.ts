import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("실제 코어에서 데스크톱마다 다른 바탕화면을 저장하고 전환한다", async () => {
  test.skip(!process.env.KS_WALLPAPER_REAL_CORE, "전용 실제 코어 시험 캐시를 지정해야 합니다");
  test.setTimeout(360_000);
  const output = process.env.KS_WALLPAPER_CAPTURE_DIR
    ?? test.info().outputPath("captures");
  mkdirSync(output, { recursive: true });
  const script = join(process.env.AGENT_COMMON_FILES_DIR!, "skills/kaleidoscope-app/scripts/sandbox.py");
  const run = spawnSync("python3", [script, "run", "--version", process.env.KS_WALLPAPER_REAL_CORE!, "--app",
    resolve(process.cwd(), "e2e/fixtures/wallpaper/app.json"), "--scenario", resolve(process.cwd(), "e2e/wallpaper-real-core.py"),
    "--viewport", "1440x900", "--out", output], { encoding: "utf8", timeout: 340_000 });
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
  expect(result.scenario_error, JSON.stringify(result)).toBeUndefined();
  expect(result.error, JSON.stringify(result)).toBeUndefined();
  expect(result.shell_commit).toBe(process.env.KS_WALLPAPER_REAL_CORE);
  expect(JSON.parse(readFileSync(join(output, "wallpaper.json"), "utf8"))).toMatchObject({
    media_round_trip: true,
    switch: { different: true },
    reload: { records: 2 },
  });
});
