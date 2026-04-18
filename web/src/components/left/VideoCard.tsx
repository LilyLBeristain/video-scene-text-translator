/**
 * <VideoCard> — the picked-file preview surface used in the left column
 * once a user has selected a video. Shows a native <video controls> playing
 * an object-URL blob, with a corner tag (INPUT / INPUT · EN / YOUR INPUT ·
 * QUEUED) and a filename + size footer in mono type.
 *
 * Design decision D3: "minimal video preview" — no custom scrubber, no
 * fps/resolution probe. The browser's own controls bar is the affordance.
 *
 * Risk mitigation R4: `URL.createObjectURL` leaks the underlying blob until
 * `URL.revokeObjectURL` runs. A `useEffect` cleanup handles that when the
 * component unmounts or the file reference changes.
 *
 * The `↻ replace` chip from the mockup is deferred per plan.md (defer list).
 * We don't render a replace button; the caller swaps this card out at the
 * phase boundary instead.
 */

import { useEffect, useState } from "react";

export type VideoCardVariant = "input" | "queued";

export interface VideoCardProps {
  file: File;
  /** "input" → INPUT tag; "queued" → YOUR INPUT · QUEUED */
  variant: VideoCardVariant;
  /** When set on variant="input", renders "INPUT · <SOURCELANG>". Ignored on "queued". */
  sourceLang?: string;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cornerTagText(
  variant: VideoCardVariant,
  sourceLang?: string,
): string {
  if (variant === "queued") return "YOUR INPUT · QUEUED";
  if (sourceLang && sourceLang.length > 0) {
    return `INPUT · ${sourceLang.toUpperCase()}`;
  }
  return "INPUT";
}

export function VideoCard({
  file,
  variant,
  sourceLang,
}: VideoCardProps): JSX.Element {
  // Blob URL lifecycle — create on mount / when the file changes, revoke on
  // unmount / before creating the next one. The initial render paints with
  // an empty src (one frame) because `useState` + `useEffect` is the only
  // way to attach a cleanup; harmless visually.
  const [blobUrl, setBlobUrl] = useState<string>("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const tag = cornerTagText(variant, sourceLang);

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative overflow-hidden rounded-md border border-[color:var(--line-2)] bg-black aspect-video"
      >
        {/* aria-hidden: the corner tag is cosmetic. The video's aria-label
            carries the filename for assistive tech. */}
        <div
          aria-hidden
          className="absolute top-2 left-2 z-10 rounded-sm bg-black/70 px-[7px] py-1 font-mono text-[9px] uppercase tracking-wider text-[color:var(--ink-1)] backdrop-blur"
        >
          {tag}
        </div>
        <video
          controls
          src={blobUrl}
          aria-label={file.name}
          className="block h-full w-full object-contain"
        />
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] tracking-wide text-[color:var(--ink-3)]">
        <span className="truncate">{file.name}</span>
        <span className="shrink-0">{formatMB(file.size)}</span>
      </div>
    </div>
  );
}
