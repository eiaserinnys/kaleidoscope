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

/** 이름과 시각이 있는 첨부만 담은 feed. 쌓기 안에서도 머리→첨부 8, feed 위 12, 마지막 아래 12를 지켜야 한다. */
export const stackFeedSpacingNamedApp = {
  id: "stack-feed-spacing-named",
  name: "쌓기 이름 있는 feed 간격 시험",
  requires: { blocks: 12, modules: {} },
  permissions: spacingPermissions,
  state: {},
  ui: {
    type: "stack",
    direction: "column",
    gap: "small",
    children: [
      { type: "text", value: "앞 글", style: "body" },
      { type: "feed", entries: [{ key: "a", name: "서소영", meta: "11-23 21:40", body: "", media: mediaOnlyEntries[0].media.slice(0, 2) }] },
      { type: "text", value: "뒤 글", style: "body" },
    ],
  },
} as unknown as AppDefinition;

/** 카드 앱 커멘트 탭과 같은 꼴: 탭 > 쌓기(gap none, fill 0) > [표 줄 커멘트 feed, 입력창 자리]. */
const commentRows = (withBody: boolean) => [
  ...(withBody ? [{ key: "c-text", name: "디렉터", meta: "11-23 21:30", body: "확인했어요", table: true, media: [] }] : []),
  ...Array.from({ length: 8 }, (_, index) => ({
    key: `c${index}`,
    name: index % 2 ? "서소영" : "디렉터",
    meta: "11-23 21:40",
    body: "",
    table: true,
    media: [index % 3 === 0
      ? { image: { permission: "media", path: "poster.jpg" }, alt: "포스터.jpg" }
      : { image: { permission: "media", path: "notes.md" }, alt: "회의록.md" }],
  })),
];

const commentTabApp = (id: string, withBody: boolean) => ({
  id,
  name: "커멘트 탭 간격 시험",
  requires: { blocks: 12, modules: {} },
  permissions: spacingPermissions,
  state: {},
  ui: {
    type: "tabs",
    tabs: [{
      label: "커멘트",
      child: {
        type: "stack",
        direction: "column",
        gap: "none",
        fill: 0,
        children: [
          { type: "feed", entries: commentRows(withBody), format: "markdown", follow: true, copy: true, collapsible: false },
          { type: "text", value: "입력창 자리", style: "body" },
        ],
      },
    }],
  },
} as unknown as AppDefinition);

/** 첨부만 담은 커멘트로 넘치는 탭. 끝까지 굴렸을 때 마지막 카드 아래가 본문 섞인 목록과 같아야 한다. */
export const stackFeedSpacingCommentsApp = commentTabApp("stack-feed-spacing-comments", false);

/** 같은 꼴에 본문 있는 커멘트를 하나 섞은 비교 앱. 맨 아래 틈이 위 앱과 같아야 한다. */
export const stackFeedSpacingCommentsMixedApp = commentTabApp("stack-feed-spacing-comments-mixed", true);

/** 묶음 feed(글 묶음 + 첨부 묶음)를 쌓기 안에 둔 표본. 글 묶음을 접고 펴도 feed 위 여백과 누른 머리가 그대로여야 한다. */
export const stackFeedSpacingGroupedApp = {
  id: "stack-feed-spacing-grouped",
  name: "쌓기 묶음 feed 간격 시험",
  requires: { blocks: 12, modules: {} },
  permissions: spacingPermissions,
  state: {},
  ui: {
    type: "stack",
    direction: "column",
    gap: "small",
    children: [
      { type: "text", value: "앞 글", style: "body" },
      { type: "feed", grouped: true, collapsible: true, entries: [
        { title: "글", items: [{ key: "t1", name: "메모", body: "본문 있는 항목" }] },
        { title: "첨부", items: [{ key: "g2", body: "", media: mediaOnlyEntries[0].media.slice(1, 3) }] },
      ] },
      { type: "text", value: "뒤 글", style: "body" },
    ],
  },
} as unknown as AppDefinition;

/** 첨부만 담은 부모 아래 본문 있는 답글. 답글을 접고 펴도 feed 위 여백과 누른 머리가 그대로여야 한다. */
export const stackFeedSpacingNestedApp = {
  id: "stack-feed-spacing-nested",
  name: "쌓기 답글 feed 간격 시험",
  requires: { blocks: 12, modules: {} },
  permissions: spacingPermissions,
  state: {},
  ui: {
    type: "stack",
    direction: "column",
    gap: "small",
    children: [
      { type: "text", value: "앞 글", style: "body" },
      { type: "feed", entries: [
        { key: "p", name: "부모", body: "", media: mediaOnlyEntries[0].media.slice(1, 2), children: [{ key: "r", name: "답글", body: "본문 있는 답글" }] },
      ] },
      { type: "text", value: "뒤 글", style: "body" },
    ],
  },
} as unknown as AppDefinition;
