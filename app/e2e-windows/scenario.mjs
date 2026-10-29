import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = process.env.GITHUB_WORKSPACE;
const results = resolve(root, 'windows-e2e');
mkdirSync(results, { recursive: true });
const log = [];
function record(step, data) { log.push({step, data}); writeFileSync(resolve(results, 'events.json'), JSON.stringify(log, null, 2)); console.log(step, data); }
function capture(name) {
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'app/e2e-windows/capture.ps1'), resolve(results, `${name}.png`)], { windowsHide: true });
  record('screen', name);
}
async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    try { return await chromium.connectOverCDP('http://127.0.0.1:9222'); } catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  throw new Error('WebView2 디버그 연결 시간 초과');
}
const browser = await waitForCdp();
try {
  const context = browser.contexts()[0];
  let main;
  for (let i = 0; i < 30 && !main; i++) {
    for (const p of context.pages()) if (await p.evaluate(() => !!window.__TAURI_INTERNALS__?.invoke).catch(() => false)) { main = p; break; }
    if (!main) await new Promise(r => setTimeout(r, 1000));
  }
  assert(main, '메인 웹뷰를 찾지 못함');
  await main.evaluate(async () => {
    window.e2eEvents = [];
    const internals = window.__TAURI_INTERNALS__;
    await internals.invoke('plugin:event|listen', { event: 'core-event', target: { kind: 'Any' }, handler: internals.transformCallback(event => window.e2eEvents.push(event.payload)) });
  });
  const call = request => main.evaluate(request => window.__TAURI_INTERNALS__.invoke('core', { request }), request);
  const definition = readFileSync(resolve(root, 'examples/web-browser.json'), 'utf8');
  await call({op:'app.import', definition_json:definition});
  const snapshot = (await call({op:'state.get'})).snapshot;
  const workspace = snapshot.device.active_workspace_id;
  const desktop = snapshot.device.active_desktop_ids[workspace];
  const {window} = await call({op:'window.open', desktop_id:desktop, app_id:'web-browser', rect:{x:48,y:48,width:880,height:600}});
  const id = window.id;
  record('window', id);
  await call({op:'web.attach', window_id:id, url:'https://example.com/'});
  await call({op:'web.place', window_id:id, bounds:{x:120,y:150,width:700,height:450}});
  await main.waitForFunction(id => window.e2eEvents.some(e => e.event === 'web.update' && e.window_id === id && e.page.url.includes('example.com') && !e.page.loading), id, { timeout:30000 });
  await new Promise(r => setTimeout(r, 1000)); capture('01-example-com');
  const png = (await call({op:'web.capture', window_id:id})).image;
  assert(png?.startsWith('data:image/png;base64,'), 'web.capture에서 PNG를 받지 못함');
  const bytes = Buffer.from(png.split(',')[1], 'base64');
  assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'PNG 서명 불일치');
  writeFileSync(resolve(results, '02-web-capture.png'), bytes);
  await call({op:'web.navigate', window_id:id, url:'https://example.org/'});
  await main.waitForFunction(id => window.e2eEvents.some(e => e.event === 'web.update' && e.window_id === id && e.page.url.includes('example.org') && !e.page.loading), id, {timeout:30000});
  await call({op:'web.history', window_id:id, action:'back'});
  await main.waitForFunction(id => { const events = window.e2eEvents.filter(e => e.event === 'web.update' && e.window_id === id); return events.some(e => e.page.url.includes('example.org')) && events.at(-1)?.page.url.includes('example.com'); }, id, {timeout:30000});
  record('web-updates', await main.evaluate(() => window.e2eEvents.filter(e => e.event === 'web.update')));
  await call({op:'web.place', window_id:id, bounds:null});
  await new Promise(r => setTimeout(r, 1000)); capture('03-hidden');
  for (const url of ['file:///C:/Windows/win.ini','http://tauri.localhost/']) {
    let rejected = false;
    try { await call({op:'web.navigate', window_id:id, url}); } catch (error) { rejected = true; record('navigation-rejected', {url, error}); }
    assert(rejected, `${url} 이동이 허용됨`);
  }
  const events = await main.evaluate(() => window.e2eEvents.filter(e => e.event === 'web.update'));
  assert(events.at(-1).page.url.includes('example.com'), '차단 뒤 주소가 바뀜');
  let child;
  for (let i = 0; i < 20 && !child; i++) { child = context.pages().find(p => p !== main && p.url().includes('example.com')); if (!child) await new Promise(r => setTimeout(r, 500)); }
  assert(child, '자식 웹뷰를 찾지 못함');
  const result = await child.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__?.invoke) return 'unavailable';
    try { await window.__TAURI_INTERNALS__.invoke('core', {request:{op:'state.get'}}); return 'allowed'; } catch { return 'rejected'; }
  });
  record('child-invoke', result); assert.notEqual(result, 'allowed', '자식 웹뷰에서 코어 명령이 허용됨');
  record('complete', 'ok');
} finally { await browser.close(); }
