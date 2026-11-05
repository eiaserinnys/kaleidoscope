# 쉘 아이콘 원본

쉘 실행 파일, 창, 작업 표시줄, 설치본과 제거 프로그램(`tauri.conf.json`의 `bundle.windows.nsis`)이 모두 `../icon.ico`를 쓴다. 쉘 좌상단 표식(`app/src/shell/brand-mark.tsx`, `app/src/shell.css`의 `.ks-brand-mark`)과 같은 기하의 네잎 클로버를 앱 아이콘과 같은 유리 타일 위에 올린 것이다.

- `icon-1024.svg`: 원본. `../source.png`는 이것을 1024로 렌더한 것이고, `pnpm tauri icon src-tauri/icons/source.png`로 나머지 파일을 만든다.
- `icon-16.svg`, `icon-24.svg`, `icon-32.svg`: 작은 크기에서 잎이 뭉치지 않게 잎 사이 틈과 클로버 크기만 키운 판이다. 잎 모양 비율은 같다.
- `tauri icon`은 `icon.ico`의 16, 24, 32 프레임과 `32x32.png`를 원본을 줄여 덮어쓴다. 다시 만들면 이 세 판을 그 크기로 렌더해 `icon.ico`의 해당 프레임(PNG 항목)과 `32x32.png`를 바꿔 넣는다.
