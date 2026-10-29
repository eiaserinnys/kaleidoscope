import { createServer } from "vite";

const server = await createServer({ configFile: "vite.config.ts" });
// Playwright가 비정상 종료해도 끊어진 표준 입력으로 테스트 서버를 함께 닫는다.
process.stdin.once("end", () => { void server.close().finally(() => process.exit(0)); });
process.stdin.resume();
await server.listen();
server.printUrls();
