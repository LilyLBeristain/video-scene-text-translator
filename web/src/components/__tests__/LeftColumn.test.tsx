/**
 * Tests for <LeftColumn> — the stateless composite that frames the left half
 * of the app shell. Every state of the app renders the same skeleton
 * (identity block → file slot → language pair slot → submit slot); only the
 * slot contents change. Per plan D7 we pin that contract, not visuals.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LeftColumn } from "../left/LeftColumn";

describe("<LeftColumn>", () => {
  it("renders the identity block plus all three passed-in slots", () => {
    render(
      <LeftColumn
        fileSlot={<div data-testid="file-slot">FILE</div>}
        languagePairSlot={<div data-testid="lang-slot">LANG</div>}
        submitSlot={<div data-testid="submit-slot">SUBMIT</div>}
      />,
    );

    // IdentityBlock is always present — its <h1> is the left-column landmark.
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /scene text translator/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByTestId("file-slot")).toBeInTheDocument();
    expect(screen.getByTestId("lang-slot")).toBeInTheDocument();
    expect(screen.getByTestId("submit-slot")).toBeInTheDocument();
  });
});
