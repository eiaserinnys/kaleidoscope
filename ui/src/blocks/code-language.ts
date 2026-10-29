import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { tags } from "@lezer/highlight";
import type { CodeLanguage } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";

const extensions: Record<string, CodeLanguage> = {
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", rs: "rust", css: "css", html: "html", htm: "html", sql: "sql", sh: "shell", bash: "shell", zsh: "shell", ps1: "shell", xml: "xml", svg: "xml", md: "markdown", markdown: "markdown",
};
export function codeLanguageForPath(path: string | null, language?: CodeLanguage): CodeLanguage {
  return language ?? extensions[path?.split(".").pop()?.toLowerCase() ?? ""] ?? "plain";
}
export function codeViewText(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
export function languageExtension(language: CodeLanguage) {
  switch (language) {
    case "json": return json();
    case "yaml": return yaml();
    case "toml": return StreamLanguage.define(toml);
    case "javascript": return javascript({ jsx: true });
    case "typescript": return javascript({ typescript: true, jsx: true });
    case "python": return python();
    case "rust": return rust();
    case "css": return css();
    case "html": return html();
    case "sql": return sql();
    case "shell": return StreamLanguage.define(shell);
    case "xml": return xml();
    case "markdown": return markdown();
    case "plain": return [];
  }
}
export const codeHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.tagName], color: "var(--ks-color-accent)" },
  { tag: [tags.string, tags.number, tags.bool, tags.atom], color: "var(--ks-color-danger)" },
  { tag: [tags.comment, tags.meta], color: "var(--ks-color-muted)" },
  { tag: [tags.variableName, tags.propertyName], color: "var(--ks-color-text)" },
]));
