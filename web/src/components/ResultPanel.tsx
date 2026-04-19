/**
 * <ResultPanel> — right-column surface for the succeeded phase. Matches
 * mockup 04-succeeded: a full-width output video with an OUTPUT corner
 * tag, then a prominent green full-width Download button underneath.
 *
 * No jobId caption — the mockup keeps the surface uncluttered and the
 * StatusBand upstream already carries the jobId chip.
 *
 * We render a plain `<a download>` styled via `buttonVariants` + success
 * color overrides instead of wrapping `<Button asChild>`; right-click →
 * Save As works on any anchor with no extra wiring.
 */

import { Download } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ResultPanelProps {
  jobId: string;
  outputUrl: string;
}

export function ResultPanel({
  jobId,
  outputUrl,
}: ResultPanelProps): JSX.Element {
  return (
    // flex-1 + min-h-0 so the panel fills the right column's remaining
    // vertical space (below StageProgress). The video area then flex-fills
    // within that budget while the download button keeps its intrinsic
    // height. Without min-h-0, flex children refuse to shrink below their
    // intrinsic size and the whole right column scrolls on short viewports
    // (e.g. 13" Mac after browser chrome).
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-black">
        {/* Corner tag — cosmetic, so `aria-hidden`. */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-2 left-2 z-10 rounded bg-background/80 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
        >
          OUTPUT
        </div>
        {/* object-contain letterboxes the video inside the flex-filled
            container so any aspect ratio stays intact without overflowing. */}
        <video
          controls
          preload="metadata"
          className="block h-full w-full bg-black object-contain"
          aria-label={`Translated output for job ${jobId}`}
        >
          <source src={outputUrl} type="video/mp4" />
          Your browser does not support embedded video playback.
        </video>
      </div>

      <a
        href={outputUrl}
        download="translated.mp4"
        className={cn(
          buttonVariants({ variant: "default" }),
          "w-full shrink-0 gap-2 bg-[color:var(--ok)] text-[color:var(--bg-0)] no-underline",
          "hover:bg-[color:var(--ok)] hover:brightness-110",
          "focus-visible:ring-[color:var(--ok)]",
        )}
      >
        <Download aria-hidden className="h-4 w-4" />
        Download translated.mp4
      </a>
    </div>
  );
}
