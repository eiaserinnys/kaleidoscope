import type { JsonValue } from "../src/contract/serde_json/JsonValue";

export const htmlReportSample: JsonValue = {
  documents: [{
    id: "sample-report", title: "브랜드 시안", revisions: [
      { rev: 1, title: "첫 시안", html: "<!doctype html><html><head><title>첫 시안</title></head><body><main><h1>새로운 시작</h1><p>함께 만드는 이야기</p></main></body></html>" },
      { rev: 2, title: "수정 시안", html: "<!doctype html><html><head><title>시안</title><style>body{font:18px sans-serif;margin:0;background:#f4f3ed;color:#222}main{padding:clamp(1rem,8vw,4rem)}h1{font-size:clamp(1.5rem,7vw,3rem)}</style></head><body><main><h1>새로운 시작</h1><p>함께 만드는 이야기</p></main></body></html>",
        comments: [{ id: "sample-comment", selected_text: "새로운 시작", selector: "h1", comment: "제목의 분위기를 조금 더 부드럽게 해 주세요.", status: "needs_user_reply", replies: [{ id: "sample-reply", author: "에이전트", role: "agent", body: "수정한 시안을 확인해 주세요." }] }] },
    ],
  }],
};
