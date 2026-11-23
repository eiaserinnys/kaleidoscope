import type { AppDefinition } from "../src/contract/contract";

/** 첨부 뷰어 시각 검수용 피드. 종류마다 첨부 하나씩 둔다. */
export const attachmentViewerApp = {
  id: "attachment-viewer-fixture",
  name: "첨부 뷰어 시험",
  requires: { blocks: 12, modules: {} },
  permissions: [{ module: "files", id: "media", access: "read", label: "첨부" }],
  state: {},
  ui: {
    type: "stack",
    direction: "column",
    gap: "medium",
    children: [
      {
        type: "feed",
        entries: [
          {
            key: "post",
            name: "서소영",
            meta: "오늘",
            body: "첨부를 눌러 확인하세요.",
            media: [
              { image: { permission: "media", path: "poster.jpg" }, alt: "포스터.jpg" },
              { image: { permission: "media", path: "clip.mp4" }, kind: "video", alt: "시연.mp4" },
              { image: { permission: "media", path: "notes.md" }, alt: "회의록.md" },
              { image: { permission: "media", path: "memo.txt" }, alt: "메모.txt" },
              { image: { permission: "media", path: "bundle.zip" }, alt: "묶음.zip" },
              { image: { permission: "media", path: "missing.pdf" }, alt: "큰 파일.pdf" },
            ],
          },
          {
            key: "long",
            name: "긴 이름",
            meta: "어제",
            body: "이름이 아주 긴 첨부입니다.",
            media: [{ image: { permission: "media", path: "long-notes.md" }, alt: "아주 긴 이름의 회의록 파일 이름이 계속 이어지는 첨부.md" }],
          },
        ],
      },
    ],
  },
} as unknown as AppDefinition;
