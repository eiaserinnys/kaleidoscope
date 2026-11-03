(() => {
  const client = window.kaleidoscope;
  let available = true;
  let tick = 0;
  let title = "Claude Code";
  let meta = "kaleidoscope-workspace";
  let folder = "kaleidoscope-workspace";
  let busy = false;

  function publish() {
    client.publish({ available, title, meta, folder, busy, tick });
  }

  function readInputs(inputs) {
    if (inputs.title?.status === "ready" && typeof inputs.title.value === "string") title = inputs.title.value;
    if (inputs.meta?.status === "ready" && typeof inputs.meta.value === "string") meta = inputs.meta.value;
    if (inputs.folder?.status === "ready" && typeof inputs.folder.value === "string") folder = inputs.folder.value;
    if (inputs.busy?.status === "ready" && typeof inputs.busy.value === "boolean") busy = inputs.busy.value;
    publish();
  }

  client.onInputs(readInputs);
  client.handle("enable_settings", () => { available = true; publish(); });
  client.handle("disable_settings", () => { available = false; publish(); });
  client.handle("stop_response", () => { busy = false; publish(); });
  client.handle("noop", () => undefined);
  publish();
  setInterval(() => { tick += 1; publish(); }, 250);
})();
