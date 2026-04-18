/**
 * <LanguageSelect> — thin wrapper around shadcn's <Select> that pairs a
 * <Label> with the trigger and renders an option per Language passed in.
 *
 * Per D6 tier 2 (wrap-and-extend): the component is ~30 lines of JSX and
 * owns no state — the parent holds the selected code and the full language
 * list. This lets the upload form fetch `/api/languages` once and pass it
 * to both source and target selects.
 */

import { useId } from "react";

import type { Language } from "@/api/schemas";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface LanguageSelectProps {
  label: string;
  value: string;
  onChange: (code: string) => void;
  languages: Language[];
  disabled?: boolean;
}

export function LanguageSelect({
  label,
  value,
  onChange,
  languages,
  disabled = false,
}: LanguageSelectProps) {
  // `useId` gives a stable SSR-safe id so the <Label htmlFor> wires up to
  // the Radix trigger. Radix forwards `id` through to the `<button>` it
  // renders for the combobox role.
  const id = useId();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder="Select a language" />
        </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
