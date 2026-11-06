(() => {
  const client = window.kaleidoscope;
  client.handle("open", async ({ event }) => {
    const file = event.files[0];
    const bytes = new Uint8Array(await client.files.read(file.id));
    client.publish({ status: `${file.name}:${Array.from(bytes).join(",")}` });
  });
  client.publish({ status: "준비됨" });
})();
