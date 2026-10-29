import { useState } from "react";
import { Button, EmptyState } from "../components/primitives";
import { FolderOpen } from "../components/icons";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";

export function FileGrant({ context, permission }: { context: BlockContext; permission: string }) {
  const [error, setError] = useState<string | null>(null);
  return <div className="ks-file-tree-ungranted"><EmptyState icon={<FolderOpen size="empty" />} text={error ?? "폴더를 선택해 주세요"} action={<Button onClick={() => { void context.store.call({ op: "files.pick_folder", window_id: context.window.id, permission }).catch((reason: unknown) => setError(toCoreError(reason).message)); }}>폴더 선택</Button>} /></div>;
}
