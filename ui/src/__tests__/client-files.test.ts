import { File as NodeFile } from "node:buffer";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserFiles } from "../runtime/client-files";

afterEach(() => {
  Reflect.deleteProperty(window, "showSaveFilePicker");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockDownload() {
  if (!URL.createObjectURL) URL.createObjectURL = () => "";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:시험");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { create, click };
}

it("출력 대상을 비운 뒤 다시 쓴 내용만 저장한다", async () => {
  mockDownload();
  vi.stubGlobal("File", NodeFile);
  const fallback = new BrowserFiles();
  const blobSink = (await fallback.savePrompt("버퍼.bin", "application/octet-stream")).sink!;
  await fallback.write(blobSink, 0, new Uint8Array([1, 2, 3]).buffer);
  await fallback.truncate(blobSink, 0);
  await fallback.write(blobSink, 0, new Uint8Array([9]).buffer);
  await fallback.close(blobSink);
  expect([...new Uint8Array(await fallback.read(blobSink))]).toEqual([9]);

  let data = new Uint8Array();
  let closed: number[] | undefined;
  const stream = {
    async write(part: { position: number; data: ArrayBuffer }) {
      const incoming = new Uint8Array(part.data);
      const result = new Uint8Array(Math.max(data.length, part.position + incoming.length));
      result.set(data); result.set(incoming, part.position); data = result;
    },
    async truncate(size: number) { data = data.slice(0, size); },
    async close() { closed = [...data]; },
  };
  Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async () => ({ createWritable: async () => stream }) });
  const native = new BrowserFiles();
  const streamSink = (await native.save("스트림.bin", "application/octet-stream")).sink!;
  await native.write(streamSink, 0, new Uint8Array([1, 2, 3]).buffer);
  await native.truncate(streamSink, 0);
  await native.write(streamSink, 0, new Uint8Array([9]).buffer);
  await native.close(streamSink);
  expect(closed).toEqual([9]);
});

it("브라우저 출력은 오프셋 쓰기를 보존하고 취소한 출력은 내려받지 않는다", async () => {
  const { create, click } = mockDownload();
  const files = new BrowserFiles();
  const first = await files.save("결과.bin", "application/octet-stream");
  expect(first.cancelled).toBe(false);
  await files.write(first.sink!, 2, new Uint8Array([3, 4]).buffer);
  await files.write(first.sink!, 0, new Uint8Array([1, 2]).buffer);
  await files.close(first.sink!);
  expect(create).toHaveBeenCalledTimes(1);
  expect((create.mock.calls[0][0] as Blob).size).toBe(4);
  expect(click).toHaveBeenCalledTimes(1);
  const second = await files.save("취소.bin", "application/octet-stream");
  await files.write(second.sink!, 0, new Uint8Array([9]).buffer);
  await files.abort(second.sink!);
  expect(click).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});

it("save_prompt 출력은 닫은 뒤 같은 창의 파일 읽기 대상으로 남는다", async () => {
  vi.stubGlobal("File", NodeFile);
  const files = new BrowserFiles();
  const save = await files.savePrompt("메모.txt", "text/plain");
  expect(save.cancelled).toBe(false);
  await files.write(save.sink!, 0, new TextEncoder().encode("저장 내용").buffer);
  await files.close(save.sink!);
  expect(new TextDecoder().decode(await files.read(save.sink!))).toBe("저장 내용");
  await files.dispose();
});

it("브라우저 내보내기의 크기 제한을 쓰기와 크기 변경 오류에 표시한다", async () => {
  const files = new BrowserFiles();
  const { sink } = await files.save("결과.bin", "application/octet-stream");
  const limit = 64 * 1024 * 1024;
  await expect(files.write(sink!, limit + 1, new ArrayBuffer(0))).rejects.toMatchObject({
    id: "SHELL_CLIENT_FILE_WRITE_TOO_LARGE", message: expect.stringContaining("64MB"),
  });
  await expect(files.truncate(sink!, limit + 1)).rejects.toMatchObject({
    id: "SHELL_CLIENT_FILE_TRUNCATE_TOO_LARGE", message: expect.stringContaining("64MB"),
  });
});
