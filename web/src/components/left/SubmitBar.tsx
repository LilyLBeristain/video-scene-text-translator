/**
 * <SubmitBar> — the bottom-of-the-left-column submit surface. A
 * discriminated-union prop (`kind`) drives five visible states the left
 * column's submit region can be in:
 *
 *   - "idle"      → "Start translation", disabled until the parent says
 *                   the form is valid. Shows a caller-supplied hint.
 *   - "uploading" → "Uploading…", disabled, hint shows `<percent>%`
 *                   (plus optional bytes label).
 *   - "running"   → "Working…", disabled, hint reminds the user that
 *                   progress is on the right.
 *   - "terminal"  → "Submit another", primary; a ghost "✗ delete job"
 *                   link appears below for resetting the job.
 *
 * Rejoin-blocked state is intentionally absent: per plan.md (D9 + R10) the
 * Rejoin CTA lives on the right-column <RejoinCard>, not here.
 *
 * All variants share the same root skeleton so the column's bottom edge
 * doesn't jump as the app transitions between phases.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SubmitBarVariant =
  | {
      kind: "idle";
      canSubmit: boolean;
      onSubmit: () => void;
      /** Optional hint line under the button — e.g. a keybind or a gentle nag. */
      hint?: string;
    }
  | {
      kind: "uploading";
      /** 0..100 integer percent. */
      percent: number;
      /** Optional byte-progress label, e.g. "21 / 50 MB". */
      bytesLabel?: string;
    }
  | { kind: "running" }
  | {
      kind: "terminal";
      onReset: () => void;
      onDelete: () => void;
      isDeleting: boolean;
    };

// The two mono text treatments used by the hint + delete-link rows. Defined
// once up top so every variant inherits the same typography.
const HINT_CLASSES =
  "font-mono text-[11px] tracking-wider text-muted-foreground";

export function SubmitBar(props: SubmitBarVariant): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t border-border px-6 pb-6 pt-4">
      {renderPrimary(props)}
      {renderHint(props)}
      {props.kind === "terminal" && (
        <button
          type="button"
          aria-label="Delete job"
          onClick={props.onDelete}
          disabled={props.isDeleting}
          className={cn(
            HINT_CLASSES,
            "self-end hover:text-destructive",
            "focus-visible:outline-none focus-visible:text-destructive",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground",
          )}
        >
          {props.isDeleting ? "Deleting…" : "\u2717 delete job"}
        </button>
      )}
    </div>
  );
}

function renderPrimary(props: SubmitBarVariant): JSX.Element {
  switch (props.kind) {
    case "idle":
      return (
        <Button
          type="button"
          variant="default"
          className="w-full"
          disabled={!props.canSubmit}
          onClick={props.onSubmit}
        >
          Start translation
        </Button>
      );
    case "uploading":
      return (
        <Button
          type="button"
          variant="default"
          className="w-full"
          disabled
        >
          Uploading…
        </Button>
      );
    case "running":
      return (
        <Button
          type="button"
          variant="default"
          className="w-full"
          disabled
        >
          Working…
        </Button>
      );
    case "terminal":
      return (
        <Button
          type="button"
          variant="default"
          className="w-full"
          onClick={props.onReset}
        >
          Submit another
        </Button>
      );
  }
}

function renderHint(props: SubmitBarVariant): JSX.Element | null {
  switch (props.kind) {
    case "idle":
      if (!props.hint) return null;
      return <div className={HINT_CLASSES}>{props.hint}</div>;
    case "uploading": {
      const text = props.bytesLabel
        ? `${props.percent}% \u00B7 ${props.bytesLabel}`
        : `${props.percent}%`;
      return <div className={HINT_CLASSES}>{text}</div>;
    }
    case "running":
      return (
        <div className={HINT_CLASSES}>
          Pipeline is running — you can watch progress on the right.
        </div>
      );
    case "terminal":
      // Hint row is replaced by the delete link, which renders below.
      return null;
  }
}
