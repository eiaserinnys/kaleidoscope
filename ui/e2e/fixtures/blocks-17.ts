import type { AppDefinition } from "../../src/contract/contract";

const definitions = [
  {
    id: "blocks-17-01",
    name: "가운데 단추 기둥",
    requires: { blocks: 17, modules: {} },
    permissions: [],
    state: { selection: "" },
    ui: {
      type: "stack", direction: "column", gap: "medium", place: "center",
      children: ["Claude Code", "Codex", "Gemini CLI", "Antigravity"].map((label) => ({
        type: "button", label, on_click: [{ set_state: "selection", value: label }],
      })),
    },
  },
  {
    id: "blocks-17-04",
    name: "오류 안내",
    requires: { blocks: 17, modules: {} },
    permissions: [],
    state: { retry: false },
    ui: {
      type: "stack", direction: "column", gap: "medium", place: "center",
      children: [{
        type: "notice", kind: "error",
        message: "저장 항목 agents: 값을 읽기 위한 서버 저장소 작업을 시작하지 못했습니다. 서버 저장소 상태를 확인하세요.",
        error_id: "STORAGE_ITEM_READ_DATABASE_FAILED",
        actions: [{ label: "다시 시도", on_click: [{ set_state: "retry", value: true }] }],
      }],
    },
  },
  {
    id: "blocks-17-05",
    name: "로딩 안내",
    requires: { blocks: 17, modules: {} },
    permissions: [],
    state: {},
    ui: {
      type: "stack", direction: "column", gap: "medium", place: "center",
      children: [{ type: "notice", kind: "loading", message: "" }],
    },
  },
  {
    id: "blocks-17-06",
    name: "폴더 고르기",
    requires: { blocks: 17, modules: {} },
    permissions: [],
    state: { folder: null },
    ui: {
      type: "stack", direction: "column", gap: "medium", place: "center",
      children: [
        { type: "button", label: "Claude Code", icon: "arrow-left", on_click: { set_state: "folder", value: null } },
        { type: "button", label: "폴더 선택", variant: "primary", on_click: [{ set_state: "folder", value: "프로젝트" }] },
      ],
    },
  },
  {
    id: "blocks-17-ellipsis",
    name: "말줄임 시험",
    requires: { blocks: 17, modules: {} },
    permissions: [],
    state: { choice: "프로젝트-자료-정리-창-말줄임-시험-선택지", pressed: false },
    ui: {
      type: "stack", direction: "column", gap: "medium", place: "center",
      children: [
        {
          type: "select", value: { state: "choice" }, on_change: { set_state: "choice" },
          options: ["프로젝트-자료-정리-창-말줄임-시험-선택지", "짧은 선택지"],
        },
        {
          type: "button", label: "긴 프로젝트 작업을 바로 실행하는 아주 긴 단추 이름", variant: "primary",
          on_click: [{ set_state: "pressed", value: true }],
        },
      ],
    },
  },
] as unknown as AppDefinition[];

export const blockSet17Fixtures = definitions;
