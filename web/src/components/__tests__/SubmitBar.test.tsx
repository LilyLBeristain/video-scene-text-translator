/**
 * Tests for <SubmitBar> — the bottom-of-left-column submit surface. Four
 * discriminated variants (`idle` / `uploading` / `running` / `terminal`) drive
 * the primary button's label + disabled state and the hint row underneath.
 * `terminal` adds a ghost "✗ delete job" link below the primary.
 *
 * Rejoin-blocked does not render here — per plan.md (R10 + D9), rejoin's CTA
 * lives on the right-column RejoinCard.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SubmitBar } from "../left/SubmitBar";

describe("<SubmitBar>", () => {
  describe("variant: idle", () => {
    it("disables the submit button when canSubmit is false and renders the hint", () => {
      const onSubmit = vi.fn();
      render(
        <SubmitBar
          kind="idle"
          canSubmit={false}
          onSubmit={onSubmit}
          hint="Pick a file and two distinct languages to submit."
        />,
      );

      const button = screen.getByRole("button", { name: /start translation/i });
      expect(button).toBeDisabled();

      // Clicking a disabled button should not call through.
      fireEvent.click(button);
      expect(onSubmit).not.toHaveBeenCalled();

      expect(
        screen.getByText(/pick a file and two distinct languages/i),
      ).toBeInTheDocument();
    });

    it("enables the submit button when canSubmit is true and fires onSubmit on click", () => {
      const onSubmit = vi.fn();
      render(
        <SubmitBar
          kind="idle"
          canSubmit
          onSubmit={onSubmit}
          hint="Ready to submit."
        />,
      );

      const button = screen.getByRole("button", { name: /start translation/i });
      expect(button).not.toBeDisabled();

      fireEvent.click(button);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("variant: uploading", () => {
    it("disables the button with an 'Uploading…' label and shows percent in the hint", () => {
      render(<SubmitBar kind="uploading" percent={42} bytesLabel="21 / 50 MB" />);

      const button = screen.getByRole("button", { name: /uploading/i });
      expect(button).toBeDisabled();

      // Hint surfaces the percent; bytesLabel is appended when provided.
      expect(screen.getByText(/42%/)).toBeInTheDocument();
      expect(screen.getByText(/21 \/ 50 MB/)).toBeInTheDocument();
    });
  });

  describe("variant: running", () => {
    it("disables the button with a 'Working…' label", () => {
      render(<SubmitBar kind="running" />);

      const button = screen.getByRole("button", { name: /working/i });
      expect(button).toBeDisabled();
    });
  });

  describe("variant: terminal", () => {
    it("renders 'Submit another' + delete link; primary fires onReset; delete fires onDelete", () => {
      const onReset = vi.fn();
      const onDelete = vi.fn();

      render(
        <SubmitBar
          kind="terminal"
          onReset={onReset}
          onDelete={onDelete}
          isDeleting={false}
        />,
      );

      const primary = screen.getByRole("button", { name: /submit another/i });
      expect(primary).not.toBeDisabled();
      fireEvent.click(primary);
      expect(onReset).toHaveBeenCalledTimes(1);

      const deleteBtn = screen.getByRole("button", { name: /delete job/i });
      expect(deleteBtn).not.toBeDisabled();
      fireEvent.click(deleteBtn);
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("disables the delete link while isDeleting is true", () => {
      const onDelete = vi.fn();

      render(
        <SubmitBar
          kind="terminal"
          onReset={() => undefined}
          onDelete={onDelete}
          isDeleting
        />,
      );

      const deleteBtn = screen.getByRole("button", { name: /delete job/i });
      expect(deleteBtn).toBeDisabled();

      fireEvent.click(deleteBtn);
      expect(onDelete).not.toHaveBeenCalled();
    });
  });
});
