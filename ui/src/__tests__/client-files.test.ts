import { expect, it, vi } from "vitest";
import { BrowserFiles } from "../runtime/client-files";

it("브라우저 출력은 오프셋 쓰기를 보존하고 취소한 출력은 내려받지 않는다", async () => {
  if (!URL.createObjectURL) URL.createObjectURL = () => "";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:시험");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
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
