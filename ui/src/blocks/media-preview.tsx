import { useCallback } from "react";
import type { MediaRef } from "../contract/contract";
import { useMedia } from "../data/use-media";
import { ImagePreview } from "./agent-attachments";

export type MediaPreviewRequest = { media: MediaRef; name: string; trigger: HTMLElement };

export function MediaPreview({ request, onClose }: { request: MediaPreviewRequest; onClose: () => void }) {
  const result = useMedia(request.media, 1600);
  const close = useCallback(() => onClose(), [onClose]);
  return result.status === "ready" ? <ImagePreview preview={{ src: result.url, name: request.name, trigger: request.trigger }} onClose={close} /> : null;
}
