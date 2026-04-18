/**
 * Tests for <LanguageSelect>. Step 6 rewrites the component from a Radix
 * <Select> to a hand-rolled native <select> styled per `.lang-select` in the
 * mockup. That lets us:
 *   - drop the Radix pointer-capture / scrollIntoView jsdom stubs,
 *   - drive the control with `fireEvent.change` (one event, no popper),
 *   - rely on the browser's built-in keyboard + a11y semantics.
 *
 * Scope (narrow, behaviour-level):
 *   1. label renders and wires to the <select> via htmlFor
 *   2. all languages render as options, one per code
 *   3. controlled `value` drives the <select>'s current choice
 *   4. onChange fires with the new code when the user picks a different option
 *   5. `disabled` → select is disabled
 *   6. `locked` → select is disabled AND a lock indicator is visible
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LanguageSelect } from "../LanguageSelect";
import type { Language } from "@/api/schemas";

const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
];

function getSelect(): HTMLSelectElement {
  // Native <select> has an implicit role of "combobox" in Testing Library's
  // ARIA mapping, but we match via the accessible name (the label) so the
  // test doubles as a check that htmlFor is wired up correctly.
  return screen.getByRole("combobox", {
    name: /source language/i,
  }) as HTMLSelectElement;
}

describe("<LanguageSelect>", () => {
  it("renders the provided label", () => {
    render(
      <LanguageSelect
        label="Source language"
        value="en"
        onChange={vi.fn()}
        languages={LANGUAGES}
      />,
    );
    expect(screen.getByText("Source language")).toBeInTheDocument();
  });

  it("renders one <option> per language", () => {
    render(
      <LanguageSelect
        label="Source language"
        value="en"
        onChange={vi.fn()}
        languages={LANGUAGES}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(LANGUAGES.length);
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "en",
      "es",
      "fr",
    ]);
  });

  it("reflects the controlled `value` prop on the <select>", () => {
    render(
      <LanguageSelect
        label="Source language"
        value="es"
        onChange={vi.fn()}
        languages={LANGUAGES}
      />,
    );
    expect(getSelect().value).toBe("es");
  });

  it("fires onChange with the new code when a different option is picked", () => {
    const onChange = vi.fn();
    render(
      <LanguageSelect
        label="Source language"
        value="en"
        onChange={onChange}
        languages={LANGUAGES}
      />,
    );

    fireEvent.change(getSelect(), { target: { value: "fr" } });

    expect(onChange).toHaveBeenCalledWith("fr");
  });

  it("disables the <select> when `disabled` is true", () => {
    render(
      <LanguageSelect
        label="Source language"
        value="en"
        onChange={vi.fn()}
        languages={LANGUAGES}
        disabled
      />,
    );
    expect(getSelect()).toBeDisabled();
  });

  it("shows a lock indicator and disables the <select> when `locked` is true", () => {
    render(
      <LanguageSelect
        label="Source language"
        value="en"
        onChange={vi.fn()}
        languages={LANGUAGES}
        locked
      />,
    );
    expect(getSelect()).toBeDisabled();
    expect(screen.getByTestId("lang-select-lock")).toBeInTheDocument();
  });
});
