import { ensureSyntaxTree, highlightingFor } from "@codemirror/language";
import { tags, type Tag } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { createMarkdownEditorState } from "../blocks/markdown-editor-state";

describe("markdown editor syntax highlighting", () => {
  it("highlights markdown content and markup with semantic tags", () => {
    const state = createMarkdownEditorState([
      "# heading",
      "",
      "*italic* **bold** `inline code`",
      "",
      "> quote",
      "",
      "[link](https://example.test)",
      "",
      "| col | val |",
      "| --- | --- |",
      "| x | y |",
      "",
      "    const indented = true",
      "",
      "- list item",
    ].join("\n"));
    const highlightingForTag = (tag: Tag) => highlightingFor(state, [tag]);

    expect(highlightingForTag(tags.heading)).toBeTruthy();
    expect(highlightingForTag(tags.emphasis)).toBeTruthy();
    expect(highlightingForTag(tags.strong)).toBeTruthy();
    expect(highlightingForTag(tags.monospace)).toBeTruthy();
    expect(highlightingForTag(tags.link)).toBeTruthy();
    expect(highlightingForTag(tags.url)).toBeTruthy();
    expect(highlightingForTag(tags.quote)).toBeTruthy();
    expect(highlightingForTag(tags.processingInstruction)).toBeTruthy();
    const tree = ensureSyntaxTree(state, state.doc.length, 5000);
    if (!tree) throw new Error("Markdown syntax tree was not parsed to the end of the document");
    const treeText = tree.toString();
    expect(treeText).toContain("TableDelimiter");
    expect(treeText).toContain("CodeBlock");
    expect(treeText).toContain("CodeText");
    expect(treeText).toContain("ListMark");
  });
});
