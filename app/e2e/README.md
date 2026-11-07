# app E2E

앱 셸을 브라우저 하네스로 검사하는 Playwright 시험입니다. 시험 파일마다 새 Vite, 새 개발용 다리, 새 문서 폴더를 씁니다.

## 준비

```sh
pnpm install --frozen-lockfile
cargo build --locked -p kaleidoscope-devbridge
```

## 실행

```sh
pnpm --dir app e2e
pnpm --dir app e2e -- share-view.spec.ts
```

- 기본 UI 포트는 1420, 코어 포트는 1421입니다. 공유 노드에서는 `KS_E2E_PORT=18456`처럼 세션 전용 값을 씁니다.
- Playwright가 머리 없는 Chromium에 기본으로 붙이는 `--hide-scrollbars`를 끕니다. 셸은 스크롤바 폭(8px)과 손잡이 안쪽 여백(2px)에 맞춰 분할 손잡이를 배치하므로 스크롤바가 보이는 상태로 검사합니다.
- runner가 `app/e2e/fixtures/documents`를 파일별 runtime의 `docs`로 복사합니다. `data`, `docs`, `artifacts`, `report.json`은 `app/test-results/<spec>/` 아래에 만들어집니다.
- Playwright를 직접 실행할 때는 `KS_E2E_RUNTIME_DIR`을 지정해야 합니다. 설정이 없는 경로나 빌드되지 않은 다리를 발견하면 바로 오류로 끝냅니다.
- 실패 trace와 화면은 `app/test-results/<spec>/playwright-output`에 남습니다.
