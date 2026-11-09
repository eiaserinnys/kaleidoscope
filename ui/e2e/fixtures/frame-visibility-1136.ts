import type { AppDefinition } from "../../src/contract/contract";

// 카드 #1136: 최소화된 창의 샌드박스 프레임이 앱의 rAF 루프를 멈추는지(보임/최소화/복원),
// 최소화 중에도 같이 보기 글 갱신이 이어지는지, 프레임이 다시 붙지 않아 스크롤이 남는지를
// 실브라우저에서 잰다. #frames는 앱 자신의 rAF 횟수, #share는 setTimeout 계열로만 바뀌는 글이다.
const railRows = Array.from({ length: 20 }, (_, index) => `<div class="row">줄 ${index + 1}</div>`).join("");

export const frameVisibilityHtml = `<style>
  html, body { margin: 0; height: 100%; font: 14px/1.4 system-ui, sans-serif; color: #111; background: #fff; }
  body { display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 8px; padding: 8px; box-sizing: border-box; height: 100%; }
  #frames, #share { margin: 0; }
  #rail { overflow-y: auto; min-height: 0; border: 1px solid #bbb; }
  .row { height: 40px; line-height: 40px; }
</style>
<div id="frames">프레임 0</div>
<div id="share">갱신 0</div>
<div id="rail">${railRows}</div>
<script>
  let frames = 0;
  let painted = 0;
  window.__frames = 0;
  const framesView = document.getElementById('frames');
  const tick = (time) => {
    frames += 1;
    window.__frames = frames;
    if (time - painted >= 250) { painted = time; framesView.textContent = '프레임 ' + frames; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  let reports = 0;
  setInterval(() => { reports += 1; document.getElementById('share').textContent = '갱신 ' + reports; }, 300);
</script>`;

export const frameVisibilityApp: AppDefinition = {
  id: "frame-visibility-1136", name: "프레임 보임 시험", requires: { blocks: 11, modules: {} }, permissions: [], state: {},
  ui: { type: "sandbox", title: "프레임 보임 시험", value: frameVisibilityHtml },
};

// 카드 #1136 B2: 클라이언트가 준비되기 전의 canvas가 빈 어두운 화면이 아니라 기존 로딩 표시를
// 보여 주는지 본다. 클라이언트 스크립트 주소를 시험이 붙잡아 두어 준비 전 상태를 만든다.
export const canvasLoadingApp: AppDefinition = {
  id: "canvas-loading-1136", name: "캔버스 준비 시험", requires: { blocks: 12, modules: { assets: 1, client: 1 } }, permissions: [], state: {},
  assets: [{ id: "canvas-loading-1136-client", version: 1 }],
  client: {
    runtime: "javascript", entry: { id: "canvas-loading-1136-client", version: 1 },
    inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: [],
  },
  ui: { type: "canvas", surface: "stage", description: "준비된 색상 무대" },
};

export const canvasLoadingMedia = { "canvas-loading-1136-client": "/__slow-client.js" };
