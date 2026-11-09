import { flushWindowEditors } from "../blocks/file-editor-session";
import { flushSandboxes } from "../blocks/sandbox-flush";
import type { ShellStore } from "../core/shell-store";
import { settleWindowInput } from "../data/window-data";
import { settleWindowStateWrites } from "../data/window-state";

/**
 * 창을 닫거나 다시 시작하기 전에 대상 창의 입력, 편집기, 샌드박스, 창 상태 쓰기를 모두 저장한다.
 * 하나라도 저장하지 못하면 commit을 부르지 않고 false를 돌려주며, 초안과 화면은 그대로 둔다.
 */
export async function runSavedTransition(store: ShellStore, windowIds: readonly string[], commit: () => Promise<void>): Promise<boolean> {
  const ids = [...windowIds];
  const inputsSaved = await Promise.all(ids.map((id) => settleWindowInput(id)));
  if (!inputsSaved.every(Boolean)) return false;
  const [editorsSaved, ...sandboxesSaved] = await Promise.all([flushWindowEditors(ids), ...ids.map((id) => flushSandboxes(id))]);
  if (!editorsSaved || !sandboxesSaved.every(Boolean)) return false;
  const writesSaved = await Promise.all(ids.map((id) => settleWindowStateWrites(store, id)));
  if (!writesSaved.every(Boolean)) return false;
  await commit();
  return true;
}
