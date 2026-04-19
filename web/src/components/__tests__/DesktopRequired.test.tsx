/**
 * Test for <DesktopRequired>. The component is a static copy-only card that
 * renders when the viewport is narrower than the app shell's fixed 1080px
 * inner width. We only verify that the heading + explanatory body copy both
 * land in the DOM — no interactions, no state.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DesktopRequired } from "../DesktopRequired";

describe("<DesktopRequired>", () => {
  it("renders the heading and body copy", () => {
    render(<DesktopRequired />);

    expect(
      screen.getByRole("heading", { name: /desktop required/i }),
    ).toBeInTheDocument();
    // Body copy mentions the 960 x 620 minimum so users know what to do.
    expect(screen.getByText(/960/)).toBeInTheDocument();
  });
});
