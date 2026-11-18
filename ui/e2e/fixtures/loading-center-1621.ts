import type { AppDefinition } from "../../src/contract/contract";

// 카드 #1621: 첫 읽기가 끝나기 전에 보이는 로딩 표시가 창 본문(프레임)의 가운데에 서는지 재려면
// 읽기가 붙잡힌 동안의 화면이 필요하다. 하네스의 저장소 문서 창은 늘 같은 창(storage-window)에
// 그려지므로, 시험이 state.changed로 그 앱 버전의 정의만 바꿔 끼운다.
// 파일 권한은 폴더 권한 하나(documents)이고, 가짜 코어의 파일 시드는 상대 경로로도 찾힌다.
export const codeViewLoadingApp: AppDefinition = {
  id: "storage-document", name: "코드 보기 불러오기 시험", requires: { blocks: 6, modules: { files: 1 } },
  permissions: [{ module: "files", id: "documents", access: "read", label: "문서 폴더" }], state: {},
  ui: { type: "code", file: { permission: "documents", path: "Kaleidoscope.md" }, read_only: true },
};

// 코드 편집기는 read_only가 없는 같은 블록이다. 읽기 실패가 로딩 글자와 같은 자리에 서는지 잰다.
export const codeEditorLoadingApp: AppDefinition = {
  id: "storage-document", name: "코드 편집기 불러오기 시험", requires: { blocks: 6, modules: { files: 1 } },
  permissions: [{ module: "files", id: "documents", access: "read", label: "문서 폴더" }], state: {},
  ui: { type: "code", file: { permission: "documents", path: "Kaleidoscope.md" } },
};

export const explorerLoadingApp: AppDefinition = {
  id: "storage-document", name: "탐색기 불러오기 시험", requires: { blocks: 6, modules: { files: 1 } },
  permissions: [{ module: "files", id: "documents", access: "read", label: "문서 폴더" }], state: {},
  ui: { type: "explorer", root: { permission: "documents" } },
};

export const sandboxLoadingApp: AppDefinition = {
  id: "storage-document", name: "샌드박스 불러오기 시험", requires: { blocks: 6, modules: { files: 1 } },
  permissions: [{ module: "files", id: "documents", access: "read", label: "문서 폴더" }], state: {},
  ui: { type: "sandbox", file: { permission: "documents", path: "settings.json" }, title: "샌드박스 불러오기 시험" },
};

// 탭 칸 안에 놓인 마크다운 보기·편집기. 탭 판의 기본 안쪽 여백이 로딩·실패 상자를 12px 들여
// 글자가 판 가운데에서 6px 위로 뜨는 것을 잰다(세라피엘 검수 장면, 카드 #1621).
export const markdownTabsLoadingApp: AppDefinition = {
  id: "storage-document", name: "탭 안 마크다운 시험", requires: { blocks: 6, modules: { storage: 1 } },
  permissions: [], state: {},
  storage: { entries: [{ id: "memo", key: "memo", kind: "md", default: "# 기본 문서", label: "문서", presentation: "hidden" }] },
  ui: { type: "split", direction: "row", sizes: [28, 72], children: [
    { type: "tabs", keep_mounted: true, tabs: [{ label: "보기", child: { type: "markdown", document: { entry: "memo" }, read_only: true } }] },
    { type: "tabs", header: false, keep_mounted: true, tabs: [{ label: "편집", child: { type: "markdown", document: { entry: "memo" } } }] },
  ] },
};
