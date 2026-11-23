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

/** 첨부만 담은 feed의 한 항목. 본문이 빈칸이고 media만 여럿이다. */
const mediaOnlyEntries = [
  {
    key: "attachments",
    body: "",
    media: [
      { image: { permission: "media", path: "poster.jpg" }, alt: "포스터.jpg" },
      { image: { permission: "media", path: "notes.md" }, alt: "회의록.md" },
      { image: { permission: "media", path: "memo.txt" }, alt: "메모.txt" },
    ],
  },
  {
    key: "attachments-2",
    body: "",
    media: [{ image: { permission: "media", path: "poster.jpg" }, alt: "포스터.jpg" }],
  },
];

const spacingPermissions = [{ module: "files", id: "media", access: "read", label: "첨부" }];

/** 쌓기 안에 글 항목, 첨부만 담은 feed 항목, 다음 항목을 차례로 둔 표본(카드 #1729 6절). */
export const stackFeedSpacingFeedApp = {
  id: "stack-feed-spacing-feed",
  name: "쌓기 feed 간격 시험",
  requires: { blocks: 12, modules: {} },
  permissions: spacingPermissions,
  state: {},
  ui: {
    type: "stack",
    direction: "column",
    gap: "small",
    children: [
      { type: "text", value: "앞 글", style: "body" },
      { type: "feed", entries: mediaOnlyEntries },
      { type: "text", value: "뒤 글", style: "body" },
    ],
  },
} as unknown as AppDefinition;

/** 같은 표본에서 feed 대신 image 블록을 둔 비교 앱. 두 틈이 feed 표본과 같아야 한다. */
export const stackFeedSpacingImageApp = {
  id: "stack-feed-spacing-image",
  name: "쌓기 image 간격 시험",
  requires: { blocks: 12, modules: {} },
  permissions: spacingPermissions,
  state: {},
  ui: {
    type: "stack",
    direction: "column",
    gap: "small",
    children: [
      { type: "text", value: "앞 글", style: "body" },
      { type: "image", src: { permission: "media", path: "poster.jpg" }, fit: "contain" },
      { type: "text", value: "뒤 글", style: "body" },
    ],
  },
} as unknown as AppDefinition;

/** 쌓기 밖(탭 바로 아래)에 둔 같은 feed. 간격이 바뀌면 안 되는 이웃이다. */
export const stackFeedSpacingTabApp = {
  id: "stack-feed-spacing-tab",
  name: "탭 feed 간격 시험",
  requires: { blocks: 12, modules: {} },
  permissions: spacingPermissions,
  state: {},
  ui: {
    type: "tabs",
    tabs: [{ label: "탭", child: { type: "feed", entries: mediaOnlyEntries } }],
  },
} as unknown as AppDefinition;
