(() => {
  const client = window.kaleidoscope;
  const report = (name, event) => parent.postMessage({ type: "chat-test-call", name, event }, "*");
  const historyItems = [
    {
      id: "history-user", kind: "user", text: "파일을 살펴봐 줘", at: "2026-11-03T00:00:00Z",
      attachments: [
        { id: "image-1", name: "표식.png", mime: "image/png" },
        { id: "text-1", name: "메모.txt", mime: "text/plain" },
      ],
    },
    { id: "history-assistant", kind: "assistant", text: "두 첨부를 확인하고 있습니다.", at: "2026-11-03T00:00:01Z", attachments: [] },
  ];
  let queueRequestId = null;
  let queueText = "";
  let resolveQueueAction = null;
  let holdNextAttachment = false;
  const snapshot = () => client.chat.publish("thread", {
    kind: "snapshot",
    items: historyItems,
    stream_id: "fixture-stream",
    text: "이미지에서 글자를 찾고 있습니다.",
    busy: true,
    tool: "파일 읽기",
    queued: [{ id: "queued-1", text: "결과도 요약해 줘", attachments: [] }],
  });

  client.handle("send", ({ event }) => {
    report("send", {
      request_id: event.request_id,
      text: event.text,
      attachments: (event.attachments || []).map((attachment) => ({
        name: attachment.name,
        mime: attachment.mime,
        byte_length: attachment.bytes.byteLength,
        first_byte: attachment.bytes.byteLength ? new Uint8Array(attachment.bytes)[0] : null,
      })),
    });
    if (event.text === "실패") {
      throw {
        id: "SHELL_CLIENT_ACTION_FAILED",
        code: "invalid_request",
        message: "요청을 보내지 못했습니다",
        details: [],
      };
    }
    if (event.text === "큐 중복 시험") {
      queueRequestId = event.request_id;
      queueText = event.text;
      return new Promise((resolve) => { resolveQueueAction = () => {
        client.chat.publish("thread", { kind: "snapshot", items: historyItems, stream_id: "fixture-response", text: "응답을 만들고 있습니다.", busy: true, tool: "파일 읽기", queued: [{ id: queueRequestId, text: queueText, attachments: [] }] });
        resolve();
      }; });
    }
    if (event.text === "재시작 대기") return new Promise(() => undefined);
    if (event.text === "응답 중") {
      client.chat.publish("thread", { kind: "event", event: { kind: "activity", busy: true, tool: "응답 생성" } });
      client.chat.publish("thread", { kind: "event", event: { kind: "text", stream_id: "fixture-response", text: "응답을 만들고 있습니다." } });
      return;
    }
    client.chat.publish("thread", { kind: "event", event: {
      kind: "item",
      item: {
        id: event.request_id, kind: "user", text: event.text, at: new Date().toISOString(),
        attachments: (event.attachments || []).map((attachment, index) => ({ id: `sent-${index}`, name: attachment.name, mime: attachment.mime })),
      },
    } });
  });

  client.handle("cancel", ({ event }) => {
    report("cancel", event);
    client.chat.publish("thread", { kind: "event", event: { kind: "activity", busy: false, tool: null } });
  });

  client.handle("attachment", async ({ event }) => {
    report("attachment", event);
    const bytes = event.attachment_id === "image-1" ? await client.assets.bytes("client-chat-image") : new TextEncoder().encode("fixture attachment").buffer;
    const mime = event.attachment_id === "image-1" ? "image/png" : "text/plain";
    if (holdNextAttachment) { holdNextAttachment = false; return; }
    client.chat.publish("thread", { kind: "attachment", request_id: event.request_id, mime, bytes });
  });

  window.addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "chat-test-emit-many") {
      for (let index = 0; index < 100; index += 1) {
        client.chat.publish("thread", { kind: "event", event: { kind: "text", stream_id: "many", text: `조각 ${index + 1}` } });
      }
    }
    if (event.data.type === "chat-test-hold-next-attachment") {
      holdNextAttachment = true;
      parent.postMessage({ type: "chat-test-attachment-held" }, "*");
    }
    if (event.data.type === "chat-test-queue-ack") resolveQueueAction?.();
    if (event.data.type === "chat-test-queue-to-history" && queueRequestId) {
      client.chat.publish("thread", { kind: "snapshot", items: [...historyItems, {
        id: queueRequestId, kind: "user", text: queueText, at: "2026-11-03T00:00:02Z", attachments: [],
      }], stream_id: "fixture-response", text: "응답을 만들고 있습니다.", busy: true, tool: "파일 읽기", queued: [] });
    }
    if (event.data.type === "chat-test-resnapshot") snapshot();
    if (event.data.type === "chat-test-continue-snapshot") {
      snapshot();
      setTimeout(() => client.chat.publish("thread", { kind: "event", event: {
        kind: "text", stream_id: "fixture-stream", text: "이미지에서 글자를 찾고 있습니다. 응답 조각이 도착했습니다.",
      } }), 120);
    }
  });

  client.publish({ footer: "도구 승인 대기" });
  setTimeout(() => parent.postMessage({ type: "chat-test-snapshot-request" }, "*"), 2000);
})();
