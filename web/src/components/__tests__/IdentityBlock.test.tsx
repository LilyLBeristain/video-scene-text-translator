/**
 * Tests for <IdentityBlock> — the static title + tagline shown at the top of
 * the left column. Trivial presentational component, but we pin the <h1>
 * landmark and the tagline copy so future copy/markup changes are explicit.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { IdentityBlock } from "../left/IdentityBlock";

describe("<IdentityBlock>", () => {
  it("renders the app title as an <h1> and shows the tagline", () => {
    render(<IdentityBlock />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: /scene text translator/i,
    });
    expect(heading).toBeInTheDocument();

    expect(
      screen.getByText(/replace on-screen text across languages/i),
    ).toBeInTheDocument();
  });
});
