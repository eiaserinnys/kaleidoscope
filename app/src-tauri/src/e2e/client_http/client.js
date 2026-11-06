(async () => {
  const app = window.kaleidoscope;
  const path = "/releases/latest.json";
  const lines = [];
  async function run(label, operation) {
    try {
      lines.push(`${label} ${await operation()}`);
    } catch (error) {
      lines.push(`${label} failed ${error?.id ?? "unknown"}: ${error?.message ?? String(error)}`);
    }
    app.publish({ result: lines.join("\n") });
  }
  async function denied(operation, expected) {
    try {
      await operation();
      return "failed unexpected success";
    } catch (error) {
      if (error?.id === expected) return "ok";
      throw error;
    }
  }
  await run("denied-request", () => denied(
    () => app.http.request({ permission: "other", path }),
    "DATA_CLIENT_HTTP_REQUEST_CLIENT_PERMISSION_DENIED",
  ));
  await run("denied-read", () => denied(
    () => app.http.read({ permission: "other", path, query: {} }),
    "DATA_CLIENT_HTTP_CLIENT_PERMISSION_DENIED",
  ));
  await run("get", async () => {
    const response = await app.http.request({ permission: "site", method: "GET", path, headers: { "Cache-Control": "no-store" } });
    const value = JSON.parse(new TextDecoder().decode(response.bytes));
    return response.status === 200 && response.headers.etag && typeof value.version === "string"
      ? "ok" : `failed status=${response.status}, etag=${response.headers.etag}, version=${value.version}`;
  });
  await run("read", async () => {
    const response = await app.http.read({ permission: "site", path, query: {} });
    return response.bytes.byteLength > 0 ? "ok" : "failed empty body";
  });
  await run("put", async () => {
    const response = await app.http.request({ permission: "site", method: "PUT", path, headers: { "Content-Type": "application/json", "If-Match": '"none"' }, body: "{}" });
    return typeof response.status === "number" ? `ok ${response.status}` : `failed status=${response.status}`;
  });
})();
