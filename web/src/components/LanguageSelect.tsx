/**
 * <LanguageSelect> — hand-rolled flat select matching the mockup's
 * `.lang-select` (web/mockup-handoff/design/mockup.html). Rewritten in Step 6
 * from a Radix-backed shadcn <Select> to a native <select>:
 *
 *   - Mockup styling is "flat field + caret on the right" — a look Radix's
 *     <Select> doesn't buy us (it renders a full popper). Custom is simpler.
 *   - Native <select> is keyboard / screen-reader accessible out of the box,
 *     immune to jsdom / Radix pointer-capture flakiness, and trivially
 *     controllable via `value` + `onChange`.
 *
 * Props stay source-compatible with the previous version except for the new
 * optional `locked` flag — a cosmetic "this select is locked for the life of
 * the job" treatment (dim border + lock icon). `locked` implies `disabled`
 * for behaviour (same a11y state), so consumers never need to set both.
 */

import { useId } from "react";
import { ChevronDown, Lock } from "lucide-react";

import type { Language } from "@/api/schemas";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface LanguageSelectProps {
  label: string;
  value: string;
  onChange: (code: string) => void;
  languages: Language[];
  disabled?: boolean;
  /**
   * Cosmetic "locked for the duration of this job" state. Adds a lock icon
   * and dimmer border; also disables the control (same a11y semantics as
   * `disabled`). When `locked` is true the `disabled` prop is ignored.
   */
  locked?: boolean;
}

export function LanguageSelect({
  label,
  value,
  onChange,
  languages,
  disabled = false,
  locked = false,
}: LanguageSelectProps) {
  const id = useId();
  const isDisabled = locked || disabled;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isDisabled}
          aria-label={label}
          className={cn(
            // Base field look — matches `.lang-select` in mockup.css.
            "w-full h-10 appearance-none truncate rounded-md px-3 text-sm",
            "bg-[color:var(--bg-1)] text-[color:var(--ink-0)]",
            "border border-[color:var(--line-2)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--acc-line)]",
            "transition-colors hover:border-[color:var(--bg-4)]",
            // Right padding reserves space for the caret (+ optional lock).
            locked ? "pr-14" : "pr-9",
            isDisabled && "cursor-not-allowed opacity-70",
            locked && "border-[color:var(--line)]",
          )}
        >
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
        {locked && (
          <Lock
            data-testid="lang-select-lock"
            className="pointer-events-none absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--ink-2)] opacity-60"
            aria-hidden
          />
        )}
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--ink-2)] opacity-70"
          aria-hidden
        />
      </div>
    </div>
  );
}
