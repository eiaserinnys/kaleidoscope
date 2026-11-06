import type { AppDefinition } from "../../src/contract/contract";
import contractSource from "../../../crates/contract/src/lib.rs?raw";

const inputDisabledVersion = Number(contractSource.match(/pub const INPUT_DISABLED_BLOCK_SET_VERSION: u32 = (\d+);/)![1]);

const definitions = [
  {
    id: "input-control-states", name: "입력 상태 시험",
    requires: { blocks: inputDisabledVersion, modules: {} }, permissions: [],
    state: { value: "같은 값", empty: "", choice: "나이", blankChoice: null, selected: "중복 제거", number: 3, date: "2026-11-06", search: "찾기" },
    ui: { type: "split", direction: "row", children: [
      { type: "stack", direction: "column", gap: "small", children: [
        { type: "input", label: "열림", value: { state: "value" }, on_change: { set_state: "value" } },
        { type: "input", label: "결과", value: { state: "value" }, read_only: true, on_change: { set_state: "value" } },
        { type: "input", label: "잠김", value: { state: "value" }, disabled: true, on_change: { set_state: "value" } },
        { type: "input", label: "빈 열림", value: { state: "empty" }, on_change: { set_state: "empty" } },
        { type: "input", label: "빈 잠김", value: { state: "empty" }, disabled: true, on_change: { set_state: "empty" } },
        { type: "input", kind: "number", spin: true, label: "잠긴 숫자", value: { state: "number" }, disabled: true, on_change: { set_state: "number" } },
        { type: "input", kind: "date", label: "잠긴 날짜", value: { state: "date" }, disabled: true, on_change: { set_state: "date" } },
        { type: "input", kind: "search", label: "잠긴 검색", value: { state: "search" }, disabled: true, on_change: { set_state: "search" } },
      ] },
      { type: "stack", direction: "column", gap: "small", children: [
        { type: "select", label: "긴 이름표 테스트", value: { state: "selected" }, on_change: { set_state: "selected" }, style: "segmented", options: ["중복 제거", "연속 중복 제거", "고유 줄", "관계"] },
        { type: "select", label: "선택됨", value: { state: "choice" }, on_change: { set_state: "choice" }, options: ["나이", "이름"] },
        { type: "select", label: "선택 전", value: { state: "blankChoice" }, on_change: { set_state: "blankChoice" }, options: ["나이", "이름"] },
      ] },
    ] },
  },
  {
    id: "input-read-only",
    name: "입력 읽기 전용",
    requires: { blocks: 25, modules: {} },
    permissions: [],
    state: { locked: true, title: "기획 회의 메모", body: "공유 문서를 읽고 필요한 내용을 복사합니다." },
    ui: { type: "stack", direction: "column", gap: "medium", children: [
      { type: "input", label: "제목", value: { state: "title" }, read_only: { state: "locked" }, on_change: { set_state: "title" } },
      { type: "input", label: "내용", multiline: true, rows: 3, value: { state: "body" }, read_only: { state: "locked" }, on_change: { set_state: "body" } },
      { type: "toggle", label: "읽기 전용", value: { state: "locked" }, on_change: { set_state: "locked" } },
    ] },
  },
  {
    id: "blocks-18-01",
    name: "가운데 단추 기둥",
    requires: { blocks: 18, modules: {} },
    permissions: [],
    state: { selection: "" },
    ui: {
      type: "stack", direction: "column", gap: "large", place: "center",
      children: [{
        type: "stack", direction: "column", gap: "small",
        children: ["Claude Code", "Codex", "Gemini CLI", "Antigravity"].map((label) => ({
          type: "button", label, on_click: [{ set_state: "selection", value: label }],
        })),
      }],
    },
  },
  {
    id: "blocks-18-04",
    name: "오류 안내",
    requires: { blocks: 18, modules: {} },
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
    id: "blocks-18-05",
    name: "로딩 안내",
    requires: { blocks: 18, modules: {} },
    permissions: [],
    state: {},
    ui: {
      type: "stack", direction: "column", gap: "medium", place: "center",
      children: [{ type: "notice", kind: "loading", message: "" }],
    },
  },
  {
    id: "blocks-18-06",
    name: "폴더 고르기",
    requires: { blocks: 18, modules: {} },
    permissions: [],
    state: { folder: null },
    ui: {
      type: "stack", direction: "column", gap: "large", place: "center",
      children: [
        { type: "button", label: "Claude Code", icon: "arrow-left", on_click: { set_state: "folder", value: null } },
        {
          type: "stack", direction: "column", gap: "small",
          children: [{ type: "button", label: "폴더 선택", variant: "primary", on_click: [{ set_state: "folder", value: "프로젝트" }] }],
        },
      ],
    },
  },
  {
    id: "blocks-18-04-multiple-actions",
    name: "여러 동작 오류 안내",
    requires: { blocks: 18, modules: {} },
    permissions: [],
    state: { message: "에이전트 Claude Code를 시작하지 못했습니다. 실행 파일 claude를 찾을 수 없습니다. 설치한 뒤 다시 시도하세요." },
    ui: {
      type: "stack", direction: "column", gap: "large", place: "center",
      children: [{
        type: "notice", kind: "error", message: { state: "message" }, error_id: "AGENT_PROCESS_SPAWN_NOT_FOUND",
        actions: [
          { label: "다시 시도", on_click: { set_state: "message", value: "다시 시도 요청을 보냈습니다." } },
          { label: "설치 안내 열기", on_click: { set_state: "message", value: "설치 안내를 열었습니다." } },
        ],
      }],
    },
  },
  {
    id: "blocks-18-truncate-glyphs",
    name: "말줄임 글자 높이 확인",
    requires: { blocks: 18, modules: {} },
    permissions: [],
    state: { choice: "Opus" },
    ui: {
      type: "stack", direction: "column", gap: "small", place: "center",
      children: [
        { type: "select", value: { state: "choice" }, on_change: { set_state: "choice" }, options: ["Opus"] },
        { type: "button", label: "Antigravity", on_click: [{ set_state: "choice", value: "Opus" }] },
      ],
    },
  },
  {
    id: "blocks-18-ellipsis",
    name: "말줄임 시험",
    requires: { blocks: 18, modules: {} },
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

export const blockSet18Fixtures = definitions;
