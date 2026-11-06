import { describe, expect, it } from "vitest";
import type { AppCommentAnchor, AppDefinition } from "../contract/contract";
import { buildDefinitionIndex, resolveDefinition } from "../comments/definition";
import { resolveScreen } from "../comments/screen";
import { encodeCommentKey, decodeCommentKey } from "../comments/key";

const definition = (children: unknown[]) => ({ ui: { type: "stack", children } }) as AppDefinition;
const text = (value: string) => ({ type: "text", value });
const anchorFor = (entry: { type: string; own_fingerprint: string; parent_child_types: string[] }, pointer: string, kind: AppCommentAnchor["kind"] = "block"): AppCommentAnchor => ({ schema_version: 1, kind, pointer, normalized_type: entry.type, own_fingerprint: entry.own_fingerprint, parent_child_types: entry.parent_child_types });

async function indexed(children: unknown[]) { return buildDefinitionIndex(definition(children)); }

describe("앱 커멘트 정의 자리", () => {
  it("앞에 삽입하면 이동, 삭제로 형제가 밀리면 제자리 없음", async () => {
    const original = await indexed([text("a"), text("b")]);
    const a = anchorFor(original.entries.get("/ui/children/0")!, "/ui/children/0");
    const b = anchorFor(original.entries.get("/ui/children/1")!, "/ui/children/1");
    const inserted = await indexed([text("new"), text("a"), text("b")]);
    expect(resolveDefinition(b, original.digest, inserted.entries, inserted.digest)).toEqual({ kind: "moved", pointer: "/ui/children/2" });
    const removed = await indexed([text("b")]);
    expect(resolveDefinition(a, original.digest, removed.entries, removed.digest)).toEqual({ kind: "orphan" });
  });
  it("제목이나 표 열만 바뀌면 제자리에 두고 다른 type은 고아로 둔다", async () => {
    const first = await indexed([{ type: "table", rows: [], columns: ["a"] }]);
    const a = anchorFor(first.entries.get("/ui/children/0")!, "/ui/children/0");
    const changed = await indexed([{ type: "table", rows: [], columns: ["b"] }]);
    expect(resolveDefinition(a, first.digest, changed.entries, changed.digest).kind).toBe("exact");
    const other = await indexed([text("a")]);
    expect(resolveDefinition(a, first.digest, other.entries, other.digest).kind).toBe("orphan");
  });
  it("중복 지문은 부모 자식 순서가 같을 때만 같은 위치로 판정", async () => {
    const first = await indexed([text("same"), text("same")]);
    const a = anchorFor(first.entries.get("/ui/children/0")!, "/ui/children/0");
    const changed = await indexed([text("same"), text("same"), { type: "notice", kind: "info" }]);
    expect(resolveDefinition(a, first.digest, changed.entries, changed.digest).kind).toBe("orphan");
    expect(resolveDefinition(a, first.digest, first.entries, first.digest).kind).toBe("exact");
  });
  it("제목 수정은 제자리이며 type뿐인 빈 지문은 새 판의 근거가 아니다", async () => {
    const first = await indexed([{ type: "section", title: "옛 제목", child: text("내용") }, { type: "chat" }]);
    const section = anchorFor(first.entries.get("/ui/children/0")!, "/ui/children/0");
    const chat = anchorFor(first.entries.get("/ui/children/1")!, "/ui/children/1");
    const changed = await indexed([{ type: "section", title: "새 제목", child: text("내용") }, { type: "chat", loading: true }]);
    expect(resolveDefinition(section, first.digest, changed.entries, changed.digest).kind).toBe("exact");
    expect(resolveDefinition(chat, first.digest, changed.entries, changed.digest).kind).toBe("orphan");
    expect(resolveDefinition({ ...section, own_fingerprint: undefined }, first.digest, changed.entries, changed.digest).kind).toBe("orphan");
  });
  it("point는 정의가 바뀌면 고아", async () => {
    const first = await indexed([{ type: "canvas", surface: "x" }]);
    const a = anchorFor(first.entries.get("/ui/children/0")!, "/ui/children/0", "point");
    const changed = await indexed([{ type: "canvas", surface: "y" }]);
    expect(resolveDefinition(a, first.digest, changed.entries, changed.digest).kind).toBe("orphan");
  });
  it("typed key는 숫자와 문자열을 구별한다", () => {
    expect(encodeCommentKey(1)).not.toBe(encodeCommentKey("1"));
    expect(decodeCommentKey(encodeCommentKey(1))).toBe(1);
    expect(decodeCommentKey(encodeCommentKey("1"))).toBe("1");
  });
});

describe("앱 커멘트 화면 자리", () => {
  it("정의가 있어도 현재 DOM에 없으면 not_visible", () => {
    const root = document.createElement("div");
    const a: AppCommentAnchor = { schema_version: 1, kind: "row", pointer: "/ui", row_identity: "absent" };
    expect(resolveScreen(a, { kind: "exact", pointer: "/ui" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("not_visible");
    expect(resolveScreen(a, { kind: "orphan" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("orphan");
  });
});

describe("화면 범위와 프레임", () => {
  const rect = (width = 200, height = 100) => ({ x: 10, y: 10, left: 10, top: 10, right: 10 + width, bottom: 10 + height, width, height, toJSON: () => ({}) }) as DOMRect;
  function windowWith(contents: string) {
    const root = document.createElement("div"); root.innerHTML = contents; document.body.append(root);
    for (const el of [document.documentElement, document.body, root, ...root.querySelectorAll<HTMLElement>("*")]) Object.defineProperty(el, "getBoundingClientRect", { configurable: true, value: () => rect() });
    return root;
  }
  it("프레임은 같은 창과 반올림한 프레임 크기에서만 보인다", () => {
    const root = windowWith('<div data-ks-block="/ui" data-ks-block-type="sandbox"><iframe></iframe></div>');
    const a: AppCommentAnchor = { schema_version: 1, kind: "point", pointer: "/ui", normalized_type: "sandbox", frame_rel: { x: 0.5, y: 0.5 }, frame_css_width: 200.2, frame_css_height: 99.8 };
    const def = { kind: "exact" as const, pointer: "/ui" };
    expect(resolveScreen(a, def, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("exact");
    expect(resolveScreen(a, def, root, { windowId: "w2", sourceWindowId: "w" }).kind).toBe("not_visible");
    expect(resolveScreen({ ...a, frame_css_width: 201 }, def, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("not_visible");
    root.remove();
  });
  it("반복 행이 가상화로 사라져도 고아가 아니다", () => {
    const root = windowWith('<div data-ks-block="/ui" data-ks-block-type="list"><div data-ks-comment-key="&quot;other&quot;">다른 행</div></div>');
    const a: AppCommentAnchor = { schema_version: 1, kind: "row", pointer: "/ui", row_identity: "missing" };
    expect(resolveScreen(a, { kind: "exact", pointer: "/ui" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("not_visible");
    root.remove();
  });
  it("다른 블록의 같은 글은 무시하고 자기 블록에 중복이면 표시하지 않는다", () => {
    const root = windowWith('<div data-ks-block="/ui/0" data-ks-block-type="text">앞 찾는 글 뒤 앞 찾는 글 뒤</div><div data-ks-block="/ui/1" data-ks-block-type="text">앞 찾는 글 뒤</div>');
    const a: AppCommentAnchor = { schema_version: 1, kind: "text", pointer: "/ui/0", quote: { exact: "찾는 글", prefix: "앞 ", suffix: " 뒤" } };
    expect(resolveScreen(a, { kind: "exact", pointer: "/ui/0" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("not_visible");
    root.querySelector('[data-ks-block="/ui/0"]')!.textContent = "다른 내용";
    expect(resolveScreen(a, { kind: "exact", pointer: "/ui/0" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("not_visible");
    root.remove();
  });
  it("같은 키도 숫자와 문자열 반복 체인을 구별한다", () => {
    const root = windowWith('<div data-repeat-key="1" data-ks-comment-key="1"><div data-ks-block="/ui/template" data-ks-block-type="text">숫자</div></div>');
    const a: AppCommentAnchor = { schema_version: 1, kind: "block", pointer: "/ui/template", repeat_chain: ["1"] };
    expect(resolveScreen(a, { kind: "exact", pointer: "/ui/template" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("not_visible");
    expect(resolveScreen({ ...a, repeat_chain: [1] }, { kind: "exact", pointer: "/ui/template" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("exact");
    root.remove();
  });
});
