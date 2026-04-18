/**
 * <StatusBand> — thin header row at the top of the right column.
 *
 *   - Left: caps-mono eyebrow label that describes the current phase
 *     ("UPLOADING", "PIPELINE · ONE WINDOW", "RESULT · SAME WINDOW", etc).
 *   - Right: status pill whose text + color change with `kind`.
 *
 * The "running" / "failed" / "blocked" kinds prepend a pulsing dot glyph.
 * prefers-reduced-motion (globals.css) dampens animate-pulse globally.
 */

import { cn } from "@/lib/utils";

export type StatusBandKind =
  | "idle"
  | "uploading"
  | "connecting"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked";

interface StatusBandProps {
  kind: StatusBandKind;
  /**
   * Active-job id. When set, renders a small mono chip between the
   * eyebrow and the status pill (e.g. "● 7ca09ebb"). The mockup carries
   * this in the window chrome, but we dropped that per D6 and the id
   * lands here instead.
   */
  jobId?: string;
}

type PillSpec = {
  label: string;
  /** When true, a pulsing "●" prefix is rendered inside the pill. */
  dot?: boolean;
  className: string;
};

// Tailwind color-token classes per pill state. Kept as a static map so the
// JIT picks up every class string at build time (no dynamic interpolation).
const NEUTRAL =
  "bg-[color:var(--bg-3)] text-muted-foreground border border-border";
const ACCENT =
  "bg-[color:var(--acc-soft)] text-[color:var(--acc)] border border-[color:var(--acc-line)]";
const OK =
  "bg-[color:var(--ok-soft)] text-[color:var(--ok)] border border-[color:var(--ok-soft)]";
const DESTRUCTIVE =
  "bg-[color:var(--err-soft)] text-[color:var(--err)] border border-[color:var(--err-line)]";
const WARN =
  "bg-[color:var(--warn-soft)] text-[color:var(--warn)] border border-[color:var(--warn-line)]";

const PILLS: Record<StatusBandKind, PillSpec> = {
  idle: { label: "IDLE", className: NEUTRAL },
  // U+2192 RIGHTWARDS ARROW — matches mockup glyph. Warn-yellow per
  // mockup .badge.warn; upload is "in progress, incomplete".
  uploading: { label: "CLIENT \u2192 SERVER", className: WARN },
  connecting: { label: "CONNECTING", className: ACCENT },
  running: { label: "LIVE", dot: true, className: ACCENT },
  succeeded: { label: "READY", className: OK },
  failed: { label: "ERR", dot: true, className: DESTRUCTIVE },
  blocked: { label: "BLOCKED", dot: true, className: WARN },
};

// Color of the leading "●" next to the job-id chip — tracks the phase so
// running reads blue, failed reads red, blocked reads yellow, etc.
const JOB_ID_DOT_CLASS: Record<StatusBandKind, string> = {
  idle: "text-[color:var(--ink-3)]",
  uploading: "text-[color:var(--warn)]",
  connecting: "text-[color:var(--acc)]",
  running: "text-[color:var(--acc)]",
  succeeded: "text-[color:var(--ok)]",
  failed: "text-[color:var(--err)]",
  blocked: "text-[color:var(--warn)]",
};

// Phase-specific eyebrow shown on the left side of the band. Unlike the pill,
// these are descriptive sentences — they name the surface the user is on.
const EYEBROW: Record<StatusBandKind, string> = {
  idle: "READY WHEN YOU ARE",
  uploading: "UPLOADING",
  connecting: "CONNECTING",
  running: "PIPELINE",
  succeeded: "RESULT",
  failed: "FAILURE",
  blocked: "ACTION REQUIRED",
};

export function StatusBand({ kind, jobId }: StatusBandProps): JSX.Element {
  const pill = PILLS[kind];
  const eyebrow = EYEBROW[kind];

  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-wider">
      <span className="text-muted-foreground">{eyebrow}</span>
      <div className="flex items-center gap-3">
        {jobId && (
          <span
            data-testid="status-band-job-id"
            className="flex items-center gap-1 text-[color:var(--ink-2)]"
          >
            <span aria-hidden className={JOB_ID_DOT_CLASS[kind]}>
              &#x25CF;
            </span>
            <span className="normal-case">{jobId.slice(0, 8)}</span>
          </span>
        )}
        <span
          className={cn(
            "rounded px-2 py-0.5",
            pill.className,
          )}
        >
          {pill.dot && (
            <span aria-hidden="true" className="mr-1 animate-pulse">
              &#x25CF;
            </span>
          )}
          {pill.label}
        </span>
      </div>
    </div>
  );
}
