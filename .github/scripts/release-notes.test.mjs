import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('.github/scripts/release-notes.mjs');
function run(content, ...args) {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    writeFileSync(join(dir, 'CHANGELOG.md'), content);
    const result = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
    return { ...result, output: args.includes('--out') && result.status === 0 ? readFileSync(join(dir, 'changes.json'), 'utf8') : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('정상 목록을 검사하고 한글을 그대로 출력한다', () => {
  const result = run('# 바뀐 것\n\n## 0.6.2\n- 새 내용\n\n## 0.6.1\n- 이전 내용\n', 'changes', '--version', '0.6.2', '--out', 'changes.json');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.output), [{ version: '0.6.2', items: ['새 내용'] }, { version: '0.6.1', items: ['이전 내용'] }]);
  assert.ok(result.output.includes('새 내용'));
});
test('판 절이 없으면 실패한다', () => {
  const result = run('## 0.6.1\n- 이전\n', 'check', '--version', '0.6.2');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CHANGELOG\.md.*0\.6\.2.*없습니다/);
});
test('절 안의 형식 밖 줄을 거부한다', () => {
  const result = run('## 0.6.1\n- 이전\n본문\n', 'check', '--version', '0.6.1');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CHANGELOG\.md.*3/);
});
test('판은 엄격히 내려가야 한다', () => {
  assert.notEqual(run('## 0.6.1\n- 하나\n## 0.6.2\n- 둘\n', 'check', '--version', '0.6.1').status, 0);
  assert.notEqual(run('## 0.6.1\n- 하나\n## 0.6.1\n- 둘\n', 'check', '--version', '0.6.1').status, 0);
});
test('받는 목록은 최대 50개 판이다', () => {
  const content = Array.from({ length: 55 }, (_, i) => `## 0.6.${55 - i}\n- 내용 ${i}\n`).join('\n');
  const result = run(content, 'changes', '--version', '0.6.55', '--out', 'changes.json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.output).length, 50);
});
