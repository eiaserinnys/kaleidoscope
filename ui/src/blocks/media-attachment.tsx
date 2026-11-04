import type { FeedMedia } from "../contract/contract";
import { Badge } from "../components/badge";
import { openContextMenu, writeMenuImage } from "../components/context-menu";
import { DataIcon } from "../components/data-icons";
import { useMedia } from "../data/use-media";
import type { MediaPreviewRequest } from "./media-preview";

export function MediaAttachment({ media, name, onPreview }: { media: FeedMedia; name: string; onPreview: (request: MediaPreviewRequest) => void }) {
  const result = useMedia(media.image, 256);
  const open = (trigger: HTMLElement) => onPreview({ media: media.image, name, trigger });
  return <div className="ks-feed-media-cell"><button type="button" className="ks-agent-attachment-image ks-feed-media-item" aria-label={name}
    title={result.status === "failed" ? `${result.error.message} ${result.error.id ?? ""}` : undefined}
    onClick={(event) => { event.stopPropagation(); if (result.status === "failed") result.retry(); else open(event.currentTarget); }}
    onContextMenu={(event) => {
      const trigger = event.currentTarget;
      const image = trigger.querySelector("img");
      openContextMenu(event, [
        { id: "image-open", label: "크게 보기", onSelect: () => open(trigger) },
        ...(image ? [{ id: "image-copy", label: "이미지 복사", onSelect: () => { void writeMenuImage(image, "이미지 복사"); } }] : []),
      ], { anchor: trigger });
    }}>
    {result.status === "ready" ? <img src={result.url} alt="" /> : result.status === "loading"
      ? <span className="ks-media-skeleton" role="status" aria-label="불러오는 중" />
      : <span className="ks-media-failed"><DataIcon name="triangle-alert" /><span>다시 받기</span></span>}
  </button>{media.kind === "video" || media.kind === "animation" ? <Badge value={media.kind === "video" ? "영상" : "GIF"} /> : null}</div>;
}
