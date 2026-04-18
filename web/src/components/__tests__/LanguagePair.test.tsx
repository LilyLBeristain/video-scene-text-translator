/**
 * Tests for <LanguagePair>. The pair composes two <LanguageSelect>s with a
 * swap button between them and an optional mono footer line. Behaviour
 * only — layout / pixel tests belong in visual diffing, not unit.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LanguagePair } from "../left/LanguagePair";
import type { Language } from "@/api/schemas";

const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
];

function renderPair(overrides: Partial<React.ComponentProps<typeof LanguagePair>> = {}) {
  const props = {
    source: "en",
    target: "es",
    languages: LANGUAGES,
    onSourceChange: vi.fn(),
    onTargetChange: vi.fn(),
    onSwap: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<LanguagePair {...props} />) };
}

describe("<LanguagePair>", () => {
  it("renders both language pickers and the swap button", () => {
    renderPair();

    // Two native <select>s, one per label.
    expect(
      screen.getByRole("combobox", { name: /source language/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /target language/i }),
    ).toBeInTheDocument();

    // Swap button is exposed with a descriptive aria-label, not just an icon.
    expect(
      screen.getByRole("button", { name: /swap source and target languages/i }),
    ).toBeInTheDocument();
  });

  it("fires onSwap when the swap button is clicked", () => {
    const { props } = renderPair();

    fireEvent.click(
      screen.getByRole("button", {
        name: /swap source and target languages/i,
      }),
    );

    expect(props.onSwap).toHaveBeenCalledTimes(1);
  });

  it("fires onSourceChange / onTargetChange when each picker changes", () => {
    const { props } = renderPair();

    fireEvent.change(
      screen.getByRole("combobox", { name: /source language/i }),
      { target: { value: "fr" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: /target language/i }),
      { target: { value: "fr" } },
    );

    expect(props.onSourceChange).toHaveBeenCalledWith("fr");
    expect(props.onTargetChange).toHaveBeenCalledWith("fr");
  });

  it("renders the footer line when `footer` is provided", () => {
    renderPair({ footer: "● LOCKED WHILE RUNNING" });
    expect(screen.getByText(/locked while running/i)).toBeInTheDocument();
  });

  it("omits the footer element entirely when `footer` is not provided", () => {
    renderPair();
    // The footer uses a stable testid so its presence/absence is
    // unambiguous regardless of copy.
    expect(screen.queryByTestId("lang-pair-footer")).toBeNull();
  });

  it("propagates `locked` to both selects (disabled + lock indicator)", () => {
    renderPair({ locked: true });

    const source = screen.getByRole("combobox", {
      name: /source language/i,
    });
    const target = screen.getByRole("combobox", {
      name: /target language/i,
    });

    expect(source).toBeDisabled();
    expect(target).toBeDisabled();
    expect(screen.getAllByTestId("lang-select-lock")).toHaveLength(2);
  });

  it("disables the swap button when `disabled` is true", () => {
    const onSwap = vi.fn();
    renderPair({ disabled: true, onSwap });

    const btn = screen.getByRole("button", {
      name: /swap source and target languages/i,
    });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(onSwap).not.toHaveBeenCalled();
  });
});
