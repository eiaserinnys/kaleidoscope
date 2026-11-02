// Register this file as client-host-services asset version 1 before importing its definition.
(() => {
  const client = window.kaleidoscope;
  const text = "Text created by the client host services example.\n";
  let savedFileId = null;

  const publish = (status) => client.publish({ status });

  client.handle("save", async () => {
    const fileId = await client.files.save_prompt({ suggested_name: "example.txt", mime: "text/plain" });
    if (!fileId) {
      publish("저장을 취소했습니다.");
      return;
    }
    try {
      const bytes = new TextEncoder().encode(text).buffer;
      // Clear a partial output in the same sink before retrying the write.
      await client.files.write(fileId, 0, bytes.slice(0, 8));
      await client.files.truncate(fileId, 0);
      await client.files.write(fileId, 0, bytes);
      await client.files.close(fileId);
      savedFileId = fileId;
      publish("파일을 저장했습니다.");
    } catch (error) {
      await client.files.abort(fileId).catch(() => undefined);
      publish(`저장하지 못했습니다: ${String(error)}`);
    }
  });

  client.handle("share", async () => {
    if (!savedFileId) {
      publish("먼저 텍스트를 저장하세요.");
      return;
    }
    if (!await client.host.can_share(savedFileId)) {
      publish("이 기기는 파일 공유를 지원하지 않습니다.");
      return;
    }
    const result = await client.host.share(savedFileId, "텍스트 예제");
    publish(result.status);
  });

  client.handle("keep_awake_on", async () => {
    publish(await client.host.keep_awake(true) ? "화면 켜짐 유지 중" : "화면 켜짐 유지를 사용할 수 없습니다.");
  });

  client.handle("keep_awake_off", async () => {
    publish(await client.host.keep_awake(false) ? "화면 켜짐 유지 해제" : "화면 켜짐 유지를 사용할 수 없습니다.");
  });
})();
