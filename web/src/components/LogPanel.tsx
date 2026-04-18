/**
 * <LogPanel> — monospace live-log surface rewritten to the mockup vocabulary.
 *
 * Layout
 * ------
 *   ┌────────────────────────────────────────┐
 *   │ LIVE LOG                      7 lines  │ ← header strip (mono, uppercase)
 *   ├────────────────────────────────────────┤
 *   │ [HH:MM:SS]  INFO  message body …       │
 *   │ [HH:MM:SS]  WARN  …                    │
 *   │ === Stage 3 ===   (bold / .hdr class)  │
 *   │ …                                      │
 *   │ (S3 silence hint — dim italic, below)  │
 *   └────────────────────────────────────────┘
 *
 * Stage-separator bolding (Risk R7 in plan.md)
 * --------------------------------------------
 * Lines whose message matches `/^={3,}\s*Stage\s+\d/i` get `.hdr` class +
 * bold font. The regex is intentionally loose so small format drift on the
 * server-side log emitter doesn't silently stop matching. If the pipeline's
 * log format ever changes, grep for `STAGE_HEADER_RE` in this file.
 *
 * S3 silence hint (plan.md §"MVP keepers")
 * ----------------------------------------
 * Stage 3 (Edit) can genuinely pause for minutes while the diffusion model
 * runs. To reassure the user that silence ≠ hang, we render a dim italic
 * line at the tail of the log whenever `currentStage === "s3"` and the
 * job is still running. This line is a UI decoration — NOT a log event
 * from the server, and carries no severity / timestamp.
 *
 * Auto-scroll
 * -----------
 * Plain auto-scroll: whenever the log array grows, the container scrolls
 * to the bottom. No "isAtBottom" escape hatch — the defer list explicitly
 * drops the "jump to latest" chip for MVP. If we discover in practice
 * that users need a read-earlier-lines mode, Step 15 polish covers it.
 *
 * Props back-compat
 * -----------------
 * `currentStage` and `isRunning` are optional so JobView's existing
 * `<LogPanel logs={...} />` call keeps compiling. When omitted, the S3
 * hint simply doesn't render.
 */

import { useEffect, useRef } from "react";

import type { LogLevel, Stage } from "@/api/schemas";
import { cn } from "@/lib/utils";

export interface LogPanelProps {
  logs: Array<{ level: LogLevel; message: string; ts: number }>;
  /** Live pipeline stage — drives the S3 silence hint. */
  currentStage?: Stage | null;
  /** Job is actively running (not terminal). Silence hint hides otherwise. */
  isRunning?: boolean;
}

// See the R7 note above. Matches 3+ equals, optional whitespace, "Stage",
// whitespace, a digit (one or more). Case-insensitive.
const STAGE_HEADER_RE = /^={3,}\s*Stage\s+\d/i;

const SEVERITY_LABEL: Record<LogLevel, string> = {
  info: "INFO",
  warning: "WARN",
  error: "ERROR",
};

// Mono chip color per severity. Token vars over Tailwind palette so the chip
// stays on-theme with the rest of the slate-dark UI.
const SEVERITY_CLASS: Record<LogLevel, string> = {
  info: "text-[color:var(--ink-2)]",
  warning: "text-[color:var(--warn)]",
  error: "text-[color:var(--err)]",
};

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function LogPanel({ logs, currentStage, isRunning }: LogPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Plain auto-scroll: on every log-count change, push to the bottom.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const showS3Hint = currentStage === "s3" && isRunning === true;

  return (
    <div className="flex h-64 flex-col overflow-hidden rounded-md border border-border bg-[color:var(--bg-1)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        <span>LIVE LOG</span>
        <span className="rounded bg-[color:var(--bg-3)] px-2 py-0.5">
          {logs.length} lines
        </span>
      </div>

      <div
        ref={panelRef}
        data-testid="log-panel"
        aria-label="Pipeline logs"
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <p className="text-muted-foreground italic">
            Waiting for pipeline output…
          </p>
        ) : (
          <>
            {logs.map((log, i) => {
              const isHeader = STAGE_HEADER_RE.test(log.message);
              return (
                <div
                  key={i}
                  data-testid="log-line"
                  className={cn(
                    "whitespace-pre-wrap text-foreground",
                    isHeader && "hdr font-semibold",
                  )}
                >
                  <span className="mr-2 text-[color:var(--ink-3)]">
                    [{formatTs(log.ts)}]
                  </span>
                  <span
                    className={cn(
                      "mr-2 font-semibold",
                      SEVERITY_CLASS[log.level],
                    )}
                  >
                    {SEVERITY_LABEL[log.level]}
                  </span>
                  <span>{log.message}</span>
                </div>
              );
            })}
            {showS3Hint && (
              <div
                data-testid="s3-hint"
                className="mt-2 text-[color:var(--ink-3)] italic"
              >
                Silence here is OK — Stage 3 (Edit) can pause for minutes on
                large scenes.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
