import type { FeedMedia } from "../contract/contract";
import { Badge } from "../components/badge";
import { openContextMenu, writeMenuImage } from "../components/context-menu";
import { DataIcon } from "../components/data-icons";
import { File as FileIcon } from "../components/icons";
import { useMedia } from "../data/use-media";
import type { AttachmentPreviewRequest } from "../data/attachments";

export function MediaAttachment({ media, name, onPreview }: { media: FeedMedia; name: string; onPreview: (request: AttachmentPreviewRequest) => void }) {
  // 영상은 원본을 미리 받지 않는다. 칩을 눌렀을 때 뷰어가 받는다.
  const still = media.kind === "video" ? null : media.image;
  const result = useMedia(still, 256);
  const open = (trigger: HTMLElement) => onPreview({ source: { kind: "media", media: media.image }, name, trigger });
  if (media.kind === "video") {
    return <div className="ks-feed-media-cell">
      <button type="button" className="ks-agent-attachment-chip ks-agent-attachment-file" aria-label={name} onClick={(event) => { event.stopPropagation(); open(event.currentTarget); }}>
        <span className="ks-agent-attachment-chip-preview"><FileIcon /></span><Badge value="영상" /><span className="ks-agent-attachment-name" title={name}>{name}</span>
      </button>
    </div>;
  }
  return <div className="ks-feed-media-cell">{result.status === "ready" && !result.url.startsWith("data:image/")
    ? <button type="button" className="ks-agent-attachment-chip ks-agent-attachment-file" aria-label={name}
      onClick={(event) => { event.stopPropagation(); open(event.currentTarget); }}>
      <span className="ks-agent-attachment-chip-preview"><FileIcon /></span><span className="ks-agent-attachment-name" title={name}>{name}</span>
    </button>
    : <button type="button" className="ks-agent-attachment-image ks-feed-media-item" aria-label={name}
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
    </button>}{media.kind === "animation" ? <Badge value="GIF" /> : null}</div>;
}
