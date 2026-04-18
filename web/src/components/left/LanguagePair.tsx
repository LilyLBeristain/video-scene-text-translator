/**
 * <LanguagePair> — stacked source + target <LanguageSelect>s with a swap
 * button between them and an optional mono footer caption (e.g.
 * "● LOCKED WHILE RUNNING"). Mirrors the `.lang-row` block in the mockup.
 *
 * Stateless: the parent owns `source`, `target`, and the swap action. The
 * swap button just invokes `onSwap()`; the parent decides what that means
 * (typically "swap the two code strings in its state"), which keeps any
 * validation (e.g. src !== tgt) in one place.
 */

import { ArrowUpDown } from "lucide-react";

import type { Language } from "@/api/schemas";
import { LanguageSelect } from "../LanguageSelect";
import { cn } from "@/lib/utils";

export interface LanguagePairProps {
  source: string;
  target: string;
  languages: Language[];
  onSourceChange: (code: string) => void;
  onTargetChange: (code: string) => void;
  onSwap: () => void;
  /** Whole pair disabled (e.g. during upload). */
  disabled?: boolean;
  /** Cosmetic locked state (running job). Implies `disabled` for both selects. */
  locked?: boolean;
  /**
   * Optional mono caption rendered under the pair — e.g.
   * "● LOCKED WHILE RUNNING" or "● JOB FAILED · RETRY OR RESUBMIT".
   * Omitted entirely when undefined.
   */
  footer?: string;
}

export function LanguagePair({
  source,
  target,
  languages,
  onSourceChange,
  onTargetChange,
  onSwap,
  disabled = false,
  locked = false,
  footer,
}: LanguagePairProps) {
  const swapDisabled = disabled || locked;

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <div className="flex-1">
          <LanguageSelect
            label="Source language"
            value={source}
            onChange={onSourceChange}
            languages={languages}
            disabled={disabled}
            locked={locked}
          />
        </div>
        <div className="flex flex-col items-center justify-end pb-0.5">
          {/* Spacer matches the <Label> line-height so the button lines up
              vertically with the select's field, not its label. */}
          <div className="h-[22px]" aria-hidden />
          <button
            type="button"
            onClick={onSwap}
            disabled={swapDisabled}
            aria-label="Swap source and target languages"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md",
              "bg-[color:var(--bg-1)] border border-[color:var(--line-2)]",
              "text-[color:var(--ink-1)] transition-colors",
              "hover:text-[color:var(--acc)] hover:border-[color:var(--acc-line)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--acc-line)]",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[color:var(--ink-1)] disabled:hover:border-[color:var(--line-2)]",
            )}
          >
            <ArrowUpDown className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex-1">
          <LanguageSelect
            label="Target language"
            value={target}
            onChange={onTargetChange}
            languages={languages}
            disabled={disabled}
            locked={locked}
          />
        </div>
      </div>

      {footer !== undefined && (
        <div
          data-testid="lang-pair-footer"
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.06em] text-[color:var(--ink-3)]"
        >
          {footer}
        </div>
      )}
    </div>
  );
}
