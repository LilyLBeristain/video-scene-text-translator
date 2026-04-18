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
  // U+2192 RIGHTWARDS ARROW — matches mockup glyph.
  uploading: { label: "CLIENT \u2192 SERVER", className: ACCENT },
  connecting: { label: "CONNECTING", className: ACCENT },
  running: { label: "LIVE", dot: true, className: ACCENT },
  succeeded: { label: "READY", className: OK },
  failed: { label: "ERR", dot: true, className: DESTRUCTIVE },
  blocked: { label: "BLOCKED", dot: true, className: WARN },
};

// Phase-specific eyebrow shown on the left side of the band. Unlike the pill,
// these are descriptive sentences — they name the surface the user is on.
const EYEBROW: Record<StatusBandKind, string> = {
  idle: "READY WHEN YOU ARE",
  uploading: "UPLOADING",
  connecting: "CONNECTING",
  running: "PIPELINE \u00B7 ONE WINDOW",
  succeeded: "RESULT \u00B7 SAME WINDOW",
  failed: "FAILURE \u00B7 SAME WINDOW",
  blocked: "ACTION REQUIRED",
};

export function StatusBand({ kind }: StatusBandProps): JSX.Element {
  const pill = PILLS[kind];
  const eyebrow = EYEBROW[kind];

  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-wider">
      <span className="text-muted-foreground">{eyebrow}</span>
      <span
        className={cn(
          "rounded px-2 py-0.5",
          pill.className,
        )}
      >
        {pill.dot && (
          // Pulsing dot glyph. Decorative — screen readers read the label.
          <span aria-hidden="true" className="mr-1 animate-pulse">
            &#x25CF;
          </span>
        )}
        {pill.label}
      </span>
    </div>
  );
}
