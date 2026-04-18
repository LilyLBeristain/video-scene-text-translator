/**
 * Tests for <LanguageSelect>. Radix Select renders its listbox into a portal
 * and requires pointer events that jsdom stubs poorly; we use userEvent to
 * click the trigger and the option, which is the same path a real user takes.
 *
 * Scope stays deliberately narrow:
 *   1. label renders
 *   2. options render after opening the listbox
 *   3. onChange fires with the selected code
 *   4. disabled prop disables the trigger
 * We don't re-test Radix's own behaviour (keyboard nav, type-ahead, …).
 */

import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LanguageSelect } from "../LanguageSelect";
import type { Language } from "@/api/schemas";

const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
];

// Radix Select uses pointer-events APIs that jsdom doesn't implement.
// Stub `hasPointerCapture` and `scrollIntoView` before any test mounts.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

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

  it("shows all language options after opening the listbox", async () => {
    const user = userEvent.setup();
    render(
      <LanguageSelect
        label="Source language"
        value="en"
        onChange={vi.fn()}
        languages={LANGUAGES}
      />,
    );

    await user.click(screen.getByRole("combobox"));

    // Radix portals options to document.body; getByRole("option", ...) still
    // finds them via the shared screen query.
    expect(
      screen.getByRole("option", { name: "English" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Spanish" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "French" }),
    ).toBeInTheDocument();
  });

  it("fires onChange with the new code when a different option is picked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LanguageSelect
        label="Source language"
        value="en"
        onChange={onChange}
        languages={LANGUAGES}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Spanish" }));

    expect(onChange).toHaveBeenCalledWith("es");
  });

  it("disables the trigger when `disabled` is true", () => {
    render(
      <LanguageSelect
        label="Source language"
        value="en"
        onChange={vi.fn()}
        languages={LANGUAGES}
        disabled
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
