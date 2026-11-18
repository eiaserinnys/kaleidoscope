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
