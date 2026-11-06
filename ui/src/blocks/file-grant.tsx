import { useState } from "react";
import type { CoreError } from "../contract/contract";
import { Button, EmptyState, ErrorId } from "../components/primitives";
import { FolderOpen } from "../components/icons";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";

export function FileGrant({ context, permission, rootProps }: { context: BlockContext; permission: string; rootProps?: import("../comments/block-root").BlockRootProps }) {
  const [error, setError] = useState<CoreError | null>(null);
  const text = error ? <>{error.message}{error.id ? <> <ErrorId id={error.id} /></> : null}</> : "폴더를 선택해 주세요";
  return <div {...rootProps} className="ks-file-tree-ungranted"><EmptyState icon={<FolderOpen size="empty" />} text={text} action={<Button data-ks-user-consent onClick={(event) => { if (event.nativeEvent.isTrusted) void context.store.call({ op: "files.pick_folder", window_id: context.window.id, permission }).catch((reason: unknown) => setError(toCoreError(reason))); }}>폴더 선택</Button>} /></div>;
}
