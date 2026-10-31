# AGENTS.md

이 리포에서 일하는 에이전트가 먼저 읽는 안내입니다.

## 정본 위치

- 설계 결정, 아키텍처 초안, 진행 기록의 정본은 atom `project > kaleidoscope`입니다. 이 리포에 같은 내용을 복사해 두지 않습니다.
- 작업 시작 전에 atom의 `아키텍처 초안`을 읽고, 결정의 근거는 `설계 결정` 아래 카드에서 봅니다.
- 코어와 화면 사이 계약의 정본은 `crates/contract/src/lib.rs`와 같은 크레이트의 `data.rs`(앱 데이터: 원천, 식 바인딩, 동작, 블록이 받는 데이터 모양), `registry.rs`(코어와 서버 사이 HTTP), `validate.rs`(앱 정의 검사)입니다. TS 타입(`ui/src/contract/`)은 거기서 생성합니다.

## 리포 구성

| 경로 | 무엇 |
|---|---|
| `crates/contract` | 코어와 화면 사이 계약(명령, 응답, 이벤트, 앱 정의, 엔티티). Rust 타입이 정본이고 ts-rs로 TS를 만든다 |
| `crates/core` | 코어. 파일, 저장, 권한 집행. Tauri에 의존하지 않는다 |
| `crates/devbridge` | 개발용 HTTP 다리. 브라우저에서 실제 코어로 화면을 검증할 때 쓴다 |
| `crates/orchestrator` | 앱 레지스트리, 기기 연결과 에이전트용 MCP 서버 |
| `ui/` | 블록 렌더러와 블록(pnpm 패키지 `@kaleidoscope/ui`). `ui/src/contract/`는 생성물이라 손대지 않는다 |
| `app/` | Tauri 앱. `app/src-tauri`는 코어를 얇게 감싸고, `app/src`는 쉘 화면이다 |
| `apps/` | 쉘과 함께 제공하는 기본 앱 정의(explorer, md-editor, html-report, web-browser 등) |
| `examples/` | workspace-pas, block-gallery, card-board 등 예제 앱 정의 |

## 자주 쓰는 명령

- 계약 TS 다시 만들기와 계약 테스트: `cargo test -p kaleidoscope-contract` (생성물이 바뀌면 함께 커밋한다)
- 코어 테스트: `cargo test -p kaleidoscope-core`
- 오케스트레이터 로컬 실행: `KALEIDOSCOPE_MCP_TOKEN=dev KALEIDOSCOPE_DB_PATH=/tmp/ks.db cargo run -p kaleidoscope-orchestrator`
- Windows 설치본은 GitHub Actions에서만 빌드한다. 개발 서버(eiaserinnys)에서는 Tauri 전체 빌드를 하지 않는다.

## 지킬 것

- 확정된 설계 결정은 뒤집지 않고 제안합니다.
- 쉘은 OS처럼 범용 기능과 범용 애셋만 담습니다. 특정 앱이나 서비스를 위한 블록, 모듈, 분기, 애셋(이름, API 경로, 데이터 모양, 초상화와 로고)을 `ui`, `app`, `crates/*`에 넣지 않습니다. 앱 고유의 것은 앱 정의(레지스트리)와 서버의 연결 설정에 두고, 새 앱에 필요한 것은 범용 블록이나 모듈로 일반화합니다. 예제 앱 정의(`examples/`)와 테스트 픽스처는 예외입니다. 근거와 기준은 atom 설계 결정 「쉘은 OS처럼 범용 기능과 범용 애셋만 (261030)」입니다.
- 서버의 환경 설정(.env, Haniel 서비스 환경)에는 서버 자신이 도는 값(바인드 주소, DB 경로, MCP 토큰)만 둡니다. 앱과 외부 서비스의 주소, 토큰, 에이전트 프로필, 폴더 id는 .env에 두지 않고, 서버 코드에도 특정 서비스의 API를 부르는 코드를 두지 않습니다. 외부 서비스 인증은 디렉터가 기기에서 웹 로그인하는 `oauth` 연결이 기본이고, `relay`는 사용자 로그인을 줄 수 없는 남의 서비스에만 `set_connection` 값으로 씁니다. 연결 헤더의 `${env:}` 참조는 쓰지 않습니다. 근거는 atom 설계 결정 「앱 설정은 서버 .env에 두지 않고, 서비스 인증은 기기 웹 로그인으로 (261030)」입니다. 작업 PAS와 연결 `soulstream`이 아직 이 규칙에 어긋나 있고 카드 #818이 바로잡습니다.
- 계약을 바꾸는 변경은 `crates/contract`를 고치고 TS를 다시 생성한 뒤, 코어와 화면을 같은 PR에서 맞춥니다.
- main에 직접 올리지 않고 브랜치와 PR로 올립니다. 공유 체크아웃(`.projects/kaleidoscope`)에서 브랜치를 바꾸지 말고 워크트리를 따서 작업합니다.
- 문서, 커밋 메시지, 주석은 한국어로 씁니다.
