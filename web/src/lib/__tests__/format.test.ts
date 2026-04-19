/**
 * Tests for `formatBytes` — tiered base-1024 formatter shared by
 * `App.tsx` (submit-bar upload line) and `components/right/UploadProgress`
 * (big readout). Contract: emit "B / KB / MB / GB" with integer B and
 * one-decimal KB / MB / two-decimal GB, all in IEC base-1024 math.
 */

import { describe, expect, it } from "vitest";

import { formatBytes } from "../format";

describe("formatBytes", () => {
  it("renders raw bytes below 1 KiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("renders KB (1 decimal) in [1 KiB, 1 MiB)", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1.5)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toMatch(/^1024\.0 KB$/);
  });

  it("renders MB (1 decimal) in [1 MiB, 1 GiB)", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 142.6)).toMatch(/^142\.6 MB$/);
  });

  it("renders GB (2 decimals) at and above 1 GiB", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.25)).toBe("2.25 GB");
  });
});
