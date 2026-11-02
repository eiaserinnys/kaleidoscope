import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const repeats = 15;
const longAnswer = "대화 내용을 확인하고 근거를 정리합니다. ".repeat(80).slice(0, 2000);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function openHistory(page: Page, count: number): Promise<number> {
  const start = performance.now();
  await page.goto(`/?conversation=ready&preview=workspace-pas&history=${count}`);
  const lastMessage = page.locator(".ks-agent-chat-history > .ks-agent-chat-assistant").last();
  await expect(lastMessage).toBeVisible();
  await expect(page.getByRole("textbox", { name: "메시지" })).toBeVisible();
  return performance.now() - start;
}

async function sampleInput(page: Page) {
  const input = page.getByRole("textbox", { name: "메시지" });
  await input.focus();
  return page.evaluate(async () => {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="메시지"]');
    if (!textarea) throw new Error("메시지 입력창을 찾지 못했습니다");
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    const start = performance.now();
    document.execCommand("insertText", false, "가");
    const immediate = performance.now();
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    return { scriptMs: immediate - start, nextPaintMs: performance.now() - start };
  });
}

async function sampleTextUpdate(page: Page, text: string) {
  return page.evaluate(async (value) => {
    const harness = (window as Window & { conversationHarness: { emitText(text: string): void } }).conversationHarness;
    const start = performance.now();
    harness.emitText(value);
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    return performance.now() - start;
  }, text);
}

async function sampleSnapshot(page: Page) {
  return page.evaluate(async () => {
    const harness = (window as Window & { conversationHarness: { moveOtherWindow(): void } }).conversationHarness;
    const start = performance.now();
    harness.moveOtherWindow();
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    return performance.now() - start;
  });
}

async function sampleScroll(page: Page) {
  return page.evaluate(async () => {
    const history = document.querySelector<HTMLElement>(".ks-agent-chat-history");
    if (!history) throw new Error("대화 기록을 찾지 못했습니다");
    let longTaskMs = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTaskMs += entry.duration;
    });
    observer.observe({ type: "longtask", buffered: false });
    history.scrollTop = history.scrollHeight;
    const top = history.scrollHeight - history.clientHeight;
    const intervals: number[] = [];
    let previous: number | null = null;
    for (let index = 1; index <= 120; index += 1) {
      const timestamp = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      if (previous !== null) intervals.push(timestamp - previous);
      previous = timestamp;
      history.scrollTop = Math.max(0, top * (1 - index / 120));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    return { p50Ms: [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length * 0.5)], p95Ms: [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length * 0.95)], longTaskMs, frames: intervals.length };
  });
}

async function sampleWheel(page: Page) {
  await page.evaluate(() => { (window as Window & { wheelStart?: number }).wheelStart = performance.now(); });
  await page.mouse.wheel(0, -320);
  return page.evaluate(async () => {
    const start = (window as Window & { wheelStart?: number }).wheelStart ?? performance.now();
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    return performance.now() - start;
  });
}

async function sampleBurst(page: Page, durationMs: number) {
  return page.evaluate(async (duration) => {
    const harness = (window as Window & { conversationHarness: { emitText(text: string): void } }).conversationHarness;
    let longTaskMs = 0;
    const bins = 15;
    const frameBins = Array.from({ length: bins }, () => 0);
    const longTaskBins = Array.from({ length: bins }, () => 0);
    const start = performance.now();
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskMs += entry.duration;
        const bin = Math.min(bins - 1, Math.floor((entry.startTime - start) / (duration / bins)));
        longTaskBins[bin] += entry.duration;
      }
    });
    observer.observe({ type: "longtask", buffered: false });
    let frames = 0;
    let raf = 0;
    const countFrame = (timestamp: number) => {
      frames += 1;
      const bin = Math.min(bins - 1, Math.floor((timestamp - start) / (duration / bins)));
      frameBins[bin] += 1;
      raf = requestAnimationFrame(countFrame);
    };
    raf = requestAnimationFrame(countFrame);
    let chunks = 0;
    const timer = setInterval(() => {
      chunks += 1;
      const length = Math.min(2000, Math.round(((chunks % 120) + 1) * 2000 / 120));
      harness.emitText("대화 내용을 확인하고 근거를 정리합니다. ".repeat(80).slice(0, length));
    }, 1000 / 60);
    await new Promise<void>((resolve) => setTimeout(resolve, duration));
    clearInterval(timer);
    cancelAnimationFrame(raf);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    return { durationMs: performance.now() - start, longTaskMs, frames, chunks, frameBins, longTaskBins };
  }, durationMs);
}

async function sampleBusy(page: Page) {
  return page.evaluate(async () => {
    const harness = (window as Window & { conversationHarness: { setBusy(busy: boolean): void } }).conversationHarness;
    const durationMs = 5000;
    const bins = 15;
    const frameBins = Array.from({ length: bins }, () => 0);
    const longTaskBins = Array.from({ length: bins }, () => 0);
    let longTaskMs = 0;
    const start = performance.now();
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskMs += entry.duration;
        const bin = Math.min(bins - 1, Math.floor((entry.startTime - start) / (durationMs / bins)));
        longTaskBins[bin] += entry.duration;
      }
    });
    observer.observe({ type: "longtask", buffered: false });
    let frames = 0;
    let raf = 0;
    const countFrame = (timestamp: number) => {
      frames += 1;
      const bin = Math.min(bins - 1, Math.floor((timestamp - start) / (durationMs / bins)));
      frameBins[bin] += 1;
      raf = requestAnimationFrame(countFrame);
    };
    raf = requestAnimationFrame(countFrame);
    harness.setBusy(true);
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    harness.setBusy(false);
    cancelAnimationFrame(raf);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    return { durationMs: performance.now() - start, longTaskMs, frames, frameBins, longTaskBins };
  });
}

test("긴 대화 성능 전후 측정", async ({ page, browserName }) => {
  page.setDefaultTimeout(300_000);
  page.setDefaultNavigationTimeout(300_000);
  const phase = process.env.KS_PERF_PHASE ?? "unlabeled";
  const results: Array<Record<string, unknown>> = [];
  for (const history of [200, 1000]) {
    for (const throttle of [1, 4]) {
      console.log(`측정 시작: ${phase}, 기록 ${history}개, CPU ${throttle === 1 ? "무제한" : `${throttle}배`}`);
      const cdp = await page.context().newCDPSession(page);
      if (throttle !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      const openMs: number[] = [];
      for (let index = 0; index < repeats; index += 1) openMs.push(await openHistory(page, history));
      console.log(`처음 열기 완료: ${median(openMs).toFixed(1)}ms`);

      await page.waitForTimeout(100);
      const inputSamples = [];
      for (let index = 0; index < repeats; index += 1) inputSamples.push(await sampleInput(page));
      console.log(`입력 완료: script ${median(inputSamples.map((sample) => sample.scriptMs)).toFixed(1)}ms`);

      const textSamples: number[] = [];
      for (let index = 1; index <= repeats; index += 1) {
        const length = Math.round(index * 2000 / repeats);
        textSamples.push(await sampleTextUpdate(page, longAnswer.slice(0, length)));
      }
      console.log(`단일 text update 완료: ${median(textSamples).toFixed(1)}ms`);

      const burstSamples = [];
      for (let index = 0; index < repeats; index += 1) burstSamples.push(await sampleBurst(page, 3000));
      const streamBurst = {
        durationMs: median(burstSamples.map((sample) => sample.durationMs)),
        longTaskMs: median(burstSamples.map((sample) => sample.longTaskMs)),
        frames: median(burstSamples.map((sample) => sample.frames)),
        chunks: median(burstSamples.map((sample) => sample.chunks)),
        samples: burstSamples,
      };
      console.log(`3초 스트리밍 완료: ${repeats}회, 중앙값 ${streamBurst.chunks}개, ${streamBurst.longTaskMs.toFixed(1)}ms long task`);
      const snapshotSamples: number[] = [];
      for (let index = 0; index < repeats; index += 1) snapshotSamples.push(await sampleSnapshot(page));
      console.log(`snapshot 완료: ${median(snapshotSamples).toFixed(1)}ms`);

      const scrollSamples = [];
      for (let index = 0; index < repeats; index += 1) scrollSamples.push(await sampleScroll(page));
      const scroll = {
        p50Ms: median(scrollSamples.map((sample) => sample.p50Ms)),
        p95Ms: median(scrollSamples.map((sample) => sample.p95Ms)),
        longTaskMs: median(scrollSamples.map((sample) => sample.longTaskMs)),
        frames: median(scrollSamples.map((sample) => sample.frames)),
        samples: scrollSamples,
      };
      console.log(`스크롤 완료: ${repeats}회, p50 ${scroll.p50Ms.toFixed(1)}ms, p95 ${scroll.p95Ms.toFixed(1)}ms`);
      const wheelSamples: number[] = [];
      for (let index = 0; index < repeats; index += 1) wheelSamples.push(await sampleWheel(page));

      const resizeSamples: number[] = [];
      for (let index = 0; index < repeats; index += 1) {
        const start = await page.evaluate(() => performance.now());
        await page.setViewportSize({ width: index % 2 === 0 ? 900 : 1100, height: 700 });
        resizeSamples.push(await page.evaluate(async (begin) => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
          return performance.now() - begin;
        }, start));
      }

      const busySamples = [];
      for (let index = 0; index < repeats; index += 1) busySamples.push(await sampleBusy(page));
      const busy = {
        durationMs: median(busySamples.map((sample) => sample.durationMs)),
        longTaskMs: median(busySamples.map((sample) => sample.longTaskMs)),
        frames: median(busySamples.map((sample) => sample.frames)),
        frameBins: busySamples[0].frameBins.map((_, index) => median(busySamples.map((sample) => sample.frameBins[index]))),
        longTaskBins: busySamples[0].longTaskBins.map((_, index) => median(busySamples.map((sample) => sample.longTaskBins[index]))),
        samples: busySamples,
      };
      console.log(`5초 busy 완료: ${repeats}회, 중앙값 ${busy.frames} frames, ${busy.longTaskMs.toFixed(1)}ms long task`);
      const result = {
        history,
        cpuThrottle: throttle === 1 ? "none" : `${throttle}x`,
        repeats,
        openMs: { median: median(openMs), samples: openMs },
        inputScriptMs: { median: median(inputSamples.map((sample) => sample.scriptMs)), samples: inputSamples.map((sample) => sample.scriptMs) },
        inputNextPaintMs: { median: median(inputSamples.map((sample) => sample.nextPaintMs)), samples: inputSamples.map((sample) => sample.nextPaintMs) },
        streamChunkNextPaintMs: { median: median(textSamples), samples: textSamples },
        streamBurst,
        snapshotNextPaintMs: { median: median(snapshotSamples), samples: snapshotSamples },
        scroll,
        wheelNextPaintMs: { median: median(wheelSamples), samples: wheelSamples },
        resizeNextPaintMs: { median: median(resizeSamples), samples: resizeSamples },
        busy,
      };
      results.push(result);
      console.log(JSON.stringify({
        history,
        cpuThrottle: result.cpuThrottle,
        openMs: result.openMs.median,
        inputScriptMs: result.inputScriptMs.median,
        inputNextPaintMs: result.inputNextPaintMs.median,
        streamChunkNextPaintMs: result.streamChunkNextPaintMs.median,
        streamBurst: { repeats, chunks: streamBurst.chunks, longTaskMs: streamBurst.longTaskMs, frames: streamBurst.frames },
        snapshotNextPaintMs: result.snapshotNextPaintMs.median,
        scroll: { repeats, p50Ms: scroll.p50Ms, p95Ms: scroll.p95Ms, longTaskMs: scroll.longTaskMs },
        wheelNextPaintMs: result.wheelNextPaintMs.median,
        resizeNextPaintMs: result.resizeNextPaintMs.median,
        busy: { repeats, frames: busy.frames, longTaskMs: busy.longTaskMs },
      }));
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await cdp.detach();
    }
  }

  const output = resolve(process.env.KS_PERF_OUTPUT ?? `test-results-perf/chat-long-history-${phase}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ phase, browserName, results }, null, 2)}\n`, "utf8");
  console.log(`측정 JSON: ${output}`);
  console.table(results.map((result) => ({
    history: result.history,
    cpu: result.cpuThrottle,
    inputMs: (result.inputScriptMs as { median: number }).median.toFixed(2),
    inputPaintMs: (result.inputNextPaintMs as { median: number }).median.toFixed(2),
    streamMs: (result.streamChunkNextPaintMs as { median: number }).median.toFixed(2),
    snapshotMs: (result.snapshotNextPaintMs as { median: number }).median.toFixed(2),
    scrollP50: (result.scroll as { p50Ms: number }).p50Ms.toFixed(2),
    scrollP95: (result.scroll as { p95Ms: number }).p95Ms.toFixed(2),
    openMs: (result.openMs as { median: number }).median.toFixed(2),
    burstChunks: (result.streamBurst as { chunks: number }).chunks,
    burstLongTaskMs: (result.streamBurst as { longTaskMs: number }).longTaskMs.toFixed(1),
    scrollLongTaskMs: (result.scroll as { longTaskMs: number }).longTaskMs.toFixed(1),
    wheelMs: (result.wheelNextPaintMs as { median: number }).median.toFixed(2),
    resizeMs: (result.resizeNextPaintMs as { median: number }).median.toFixed(2),
    busyFrames: (result.busy as { frames: number }).frames,
    busyLongTaskMs: (result.busy as { longTaskMs: number }).longTaskMs.toFixed(1),
  })));
});
