import { readFileSync, writeFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const compare = (a, b) => {
  const left = a.split('.').map(BigInt);
  const right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
};

try {
  if (!['check', 'changes'].includes(command)) throw new Error('명령은 check 또는 changes를 쓰세요.');
  const version = args.includes('--version') ? option('--version') : JSON.parse(readFileSync('app/src-tauri/tauri.conf.json', 'utf8')).version;
  if (!version || (!semver.test(version) && !version.includes('-'))) throw new Error(`판 ${version ?? ''}이 올바르지 않습니다. X.Y.Z 형식으로 지정하세요.`);
  if (command === 'changes' && (!args.includes('--version') || !args.includes('--out') || !option('--out'))) throw new Error('changes에는 --version과 --out을 지정하세요.');
  const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      const v = line.slice(3);
      if (!semver.test(v)) throw new Error(`CHANGELOG.md ${i + 1}행의 판이 올바르지 않습니다. ## X.Y.Z 형식으로 적으세요.`);
      const previous = sections.at(-1);
      if (previous && !previous.items.length) throw new Error(`CHANGELOG.md의 ${previous.version} 절에 항목이 없습니다. 바뀐 것을 - 로 적으세요.`);
      if (previous && compare(previous.version, v) <= 0) throw new Error(`CHANGELOG.md ${i + 1}행의 ${v} 판 순서가 잘못됐습니다. 새 판부터 중복 없이 적으세요.`);
      sections.push({ version: v, items: [] });
    } else if (sections.length && line !== '') {
      if (!/^- \S/.test(line)) throw new Error(`CHANGELOG.md ${i + 1}행의 형식이 잘못됐습니다. 바뀐 것을 - 뒤에 한 줄로 적으세요.`);
      sections.at(-1).items.push(line.slice(2));
    }
  }
  const last = sections.at(-1);
  if (last && !last.items.length) throw new Error(`CHANGELOG.md의 ${last.version} 절에 항목이 없습니다. 바뀐 것을 - 로 적으세요.`);
  if ((command === 'changes' || !version.includes('-')) && !sections.some((section) => section.version === version)) throw new Error(`CHANGELOG.md에 ${version} 절이 없습니다. 맨 위에 \`## ${version}\` 절을 만들고 이 판에서 바뀐 것을 \`- \`로 한 줄씩 적으세요`);
  if (command === 'changes') {
    const changes = sections.filter((section) => compare(section.version, version) <= 0).slice(0, 50);
    writeFileSync(option('--out'), JSON.stringify(changes), 'utf8');
  }
} catch (error) {
  console.error(String(error.message).replace(/[\r\n]+/g, ' '));
  process.exitCode = 1;
}
