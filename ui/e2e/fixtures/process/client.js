(() => {
  const client = window.kaleidoscope;
  const api = client.process;
  let handle = null;
  let after = 0;
  let checkpoint = { number: -1, partial: "", pid: "", error: "" };
  let draining = false;
  let again = false;
  const publish = (status) => client.publish({ status, number: checkpoint.number, pid: checkpoint.pid, partial: checkpoint.partial.length, error: checkpoint.error });
  async function drain() {
    if (!handle) return;
    if (draining) { again = true; return; }
    draining = true;
    try {
      do {
        again = false;
        for (;;) {
          const result = await api.read({ handle, after, max_bytes: 65536 });
          if (!result.bytes.length) break;
          const text = checkpoint.partial + new TextDecoder().decode(result.bytes);
          const lines = text.split("\n");
          checkpoint.partial = lines.pop();
          for (const line of lines) {
            const [pid, raw] = line.split("|");
            const number = Number(raw);
            if (checkpoint.pid && checkpoint.pid !== pid) checkpoint.error = `pid ${checkpoint.pid} → ${pid}`;
            if (number !== checkpoint.number + 1) checkpoint.error = `순서 ${checkpoint.number} → ${number}`;
            checkpoint.pid = pid;
            checkpoint.number = number;
          }
          after = result.next;
          await api.ack({ handle, after, checkpoint });
          publish("실행 중");
        }
      } while (again);
    } catch (error) { publish(`${error.id || "오류"}: ${error.message}`); }
    finally { draining = false; }
  }
  api.onReady((readyHandle) => { if (readyHandle === handle) void drain(); });
  client.handle("start", async () => {
    try {
      const inputs = client.inputs;
      const result = await api.start({ key: "main", permission: "run", cwd_permission: "work", spec: { name: "시험 프로그램", command: inputs.command.value, args: ["-u", inputs.script.value], env: {} } });
      if (result.status === "cancelled") { publish("취소됨"); return; }
      handle = result.handle;
      publish("실행 중");
      await drain();
    } catch (error) { publish(`${error.id || "오류"}: ${error.message}`); }
  });
  client.onLifecycle(async ({ phase }) => {
    if (phase !== "ready") return;
    try {
      const current = await api.attach({ key: "main" });
      if (!current) { publish("대기"); return; }
      handle = current.handle;
      after = current.after;
      if (current.checkpoint) checkpoint = current.checkpoint;
      publish("재연결");
      await drain();
    } catch (error) { publish(`${error.id || "오류"}: ${error.message}`); }
  });
})();
