import type { AppDefinition } from "../../src/contract/contract";

export const sectionMoveHeadingApp: AppDefinition = {
  id: "section-move-heading-1705",
  name: "읽기 목록",
  requires: { blocks: 37, modules: {} },
  permissions: [],
  state: {},
  ui: {
    type: "split", direction: "row", sizes: [40, 60],
    children: [
      { type: "list", items: [{ key: "a", title: "첫 글" }] },
      {
        type: "section",
        title: "Claude Code sends your email address to websites",
        meta: "작성자 2026-11-05 22:17",
        actions: [
          { type: "button", label: "북마크", icon: "bookmark", variant: "ghost", on_click: [] },
          { type: "button", label: "안 읽음으로 표시", icon: "rotate-ccw", variant: "ghost", on_click: [] },
          { type: "button", label: "브라우저에서 열기", icon: "external-link", variant: "default", on_click: [] },
        ],
        child: { type: "text", value: "읽을 글의 본문입니다." },
      },
    ],
  },
};
