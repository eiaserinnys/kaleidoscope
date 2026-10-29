import { describe, expect, it } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { findAppsForExtension } from "../blocks/explorer";
import { makeTestSnapshot, mdEditorDefinition, mdViewerDefinition } from "./fixtures";

const notesViewer: AppDefinition = {
  ...mdEditorDefinition,
  id: "notes-viewer",
  name: "노트 보기",
  opens: { extensions: ["md", "txt"], permission: "docs", state: "current_file" },
};

const textViewer: AppDefinition = {
  ...notesViewer,
  id: "text-viewer",
  name: "텍스트 보기",
  opens: { extensions: ["txt"], permission: "docs", state: "current_file" },
};

describe("explorer app selection", () => {
  it("chooses the current app definition that opens the extension", () => {
    const snapshot = makeTestSnapshot({ definitions: [mdEditorDefinition, mdViewerDefinition] });
    expect(findAppsForExtension(snapshot, "md").map((app) => app.id)).toEqual(["md-editor"]);
  });

  it("orders multiple matching apps by Korean name", () => {
    const snapshot = makeTestSnapshot({ definitions: [mdEditorDefinition, textViewer, notesViewer] });
    expect(findAppsForExtension(snapshot, "TXT").map((app) => app.name)).toEqual(["노트 보기", "텍스트 보기"]);
  });

  it("returns no app when the extension has no opener", () => {
    const snapshot = makeTestSnapshot({ definitions: [mdEditorDefinition, mdViewerDefinition] });
    expect(findAppsForExtension(snapshot, "png")).toEqual([]);
  });
});
