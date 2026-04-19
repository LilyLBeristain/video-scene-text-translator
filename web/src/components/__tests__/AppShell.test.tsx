/**
 * Tests for <AppShell>. The shell is a presentational two-column frame:
 *   - renders the `left` and `right` slot children
 *   - falls back to <DesktopRequired> when window.innerWidth < 960 or
 *     window.innerHeight < 620
 *   - swaps back to the shell when the viewport grows past 960 × 620 px
 *
 * jsdom's default viewport is 1024 × 768 — width is above the 960 floor
 * but tests still widen innerWidth so a future jsdom default change
 * doesn't silently shift us below it. Height defaults are safely above
 * 620. `afterEach` restores a wide viewport so no test inherits a
 * narrow one.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { AppShell } from "../AppShell";

function setViewportWidth(w: number): void {
  // innerWidth is a read-only getter on window by default; redefine it
  // so we can simulate resize without a real browser. `configurable: true`
  // so successive tests can re-set it.
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: w,
  });
}

function setViewportHeight(h: number): void {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: h,
  });
}

afterEach(() => {
  // Reset to a safely-wide viewport so later (non-AppShell) tests aren't
  // left with an accidental narrow-window state.
  setViewportWidth(1440);
  setViewportHeight(900);
});

describe("<AppShell>", () => {
  it("renders both left and right slot children when the viewport is wide enough", () => {
    setViewportWidth(1440);
    setViewportHeight(900);

    render(
      <AppShell
        left={<div data-testid="L">left slot</div>}
        right={<div data-testid="R">right slot</div>}
      />,
    );

    expect(screen.getByTestId("L")).toBeInTheDocument();
    expect(screen.getByTestId("R")).toBeInTheDocument();
  });

  it("shows <DesktopRequired> instead of the shell when innerWidth < 960", () => {
    // 920 sits just below the 960 floor — explicitly covers the new
    // threshold, not an older 1080 one.
    setViewportWidth(920);
    setViewportHeight(900);

    render(
      <AppShell
        left={<div data-testid="L">left slot</div>}
        right={<div data-testid="R">right slot</div>}
      />,
    );

    // Slots should not be in the document at all — the fallback replaces
    // the shell, not wraps it.
    expect(screen.queryByTestId("L")).toBeNull();
    expect(screen.queryByTestId("R")).toBeNull();
    expect(
      screen.getByRole("heading", { name: /desktop required/i }),
    ).toBeInTheDocument();
  });

  it("swaps back to the shell when the viewport grows past 960 at runtime", () => {
    setViewportWidth(920);
    setViewportHeight(900);

    render(
      <AppShell
        left={<div data-testid="L">left slot</div>}
        right={<div data-testid="R">right slot</div>}
      />,
    );

    // Sanity check: starts on the fallback card.
    expect(
      screen.getByRole("heading", { name: /desktop required/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("L")).toBeNull();

    // Resize up past the 960 floor. Wrap in `act` so React flushes the
    // state update from the component's resize listener before we assert.
    act(() => {
      setViewportWidth(1200);
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByTestId("L")).toBeInTheDocument();
    expect(screen.getByTestId("R")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /desktop required/i }),
    ).toBeNull();
  });

  it("shows <DesktopRequired> when innerHeight < 620 even if width is fine", () => {
    // Width above the 960 floor but height starved — the guard should
    // fire on height alone.
    setViewportWidth(1280);
    setViewportHeight(500);

    render(
      <AppShell
        left={<div data-testid="L">left slot</div>}
        right={<div data-testid="R">right slot</div>}
      />,
    );

    expect(screen.queryByTestId("L")).toBeNull();
    expect(screen.queryByTestId("R")).toBeNull();
    expect(
      screen.getByRole("heading", { name: /desktop required/i }),
    ).toBeInTheDocument();
  });

  it("swaps back to the shell when innerHeight grows past 620 at runtime", () => {
    setViewportWidth(1280);
    setViewportHeight(500);

    render(
      <AppShell
        left={<div data-testid="L">left slot</div>}
        right={<div data-testid="R">right slot</div>}
      />,
    );

    // Sanity check: starts on the fallback card.
    expect(
      screen.getByRole("heading", { name: /desktop required/i }),
    ).toBeInTheDocument();

    act(() => {
      setViewportHeight(800);
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByTestId("L")).toBeInTheDocument();
    expect(screen.getByTestId("R")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /desktop required/i }),
    ).toBeNull();
  });
});
