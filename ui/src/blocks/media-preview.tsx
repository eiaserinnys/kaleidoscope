import { useCallback } from "react";
import type { MediaRef } from "../contract/contract";
import { useMedia } from "../data/use-media";
import { Button, Notice } from "../components/primitives";
import { ImagePreview } from "./agent-attachments";

export type MediaPreviewRequest = { media: MediaRef; name: string; trigger: HTMLElement };

export function MediaPreview({ request, onClose }: { request: MediaPreviewRequest; onClose: () => void }) {
  const result = useMedia(request.media, 1600);
  const close = useCallback(() => onClose(), [onClose]);
  return <ImagePreview preview={{ src: result.status === "ready" ? result.url : "", name: request.name, trigger: request.trigger }} onClose={close}>
    {result.status === "loading" ? <div className="ks-media-preview-state" onClick={(event) => event.stopPropagation()}><div className="ks-data-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div></div>
      : result.status === "failed" ? <div className="ks-media-preview-state" onClick={(event) => event.stopPropagation()}><Notice role="alert" errorId={result.error.id}>{result.error.message}</Notice><Button onClick={result.retry}>다시 받기</Button></div> : undefined}
  </ImagePreview>;
}
