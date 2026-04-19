/**
 * <AppShell> — presentational two-column frame, fluid within bounds.
 *
 * Sizing strategy:
 *   - Fills the viewport minus a small gutter (`p-4`).
 *   - Clamped at `max-w-[1440px] × max-h-[880px]` so ultra-wide / tall
 *     monitors don't stretch the layout past a pleasant ratio.
 *   - Floored at `min-w-[960px] × min-h-[600px]` so we guarantee the
 *     primitives still fit at typical laptop sizes.
 *   - Left column stays fixed at 400px (form controls don't benefit
 *     from extra width). Right column `flex-1` so it absorbs the growth.
 *
 * Viewport guard: when `innerWidth < 960` OR `innerHeight < 620`, the
 * shell is replaced (not wrapped) by <DesktopRequired>. Resize listener
 * keeps the split in sync. SSR guard is cosmetic — this project isn't
 * server-rendered.
 */

import { useEffect, useState } from "react";

import { DesktopRequired } from "@/components/DesktopRequired";

const MIN_VIEWPORT_WIDTH = 960;
const MIN_VIEWPORT_HEIGHT = 620;

interface AppShellProps {
  left: React.ReactNode;
  right: React.ReactNode;
}

function fits(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.innerWidth >= MIN_VIEWPORT_WIDTH &&
    window.innerHeight >= MIN_VIEWPORT_HEIGHT
  );
}

export function AppShell({ left, right }: AppShellProps): JSX.Element {
  const [ok, setOk] = useState<boolean>(fits);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setOk(fits());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!ok) {
    return <DesktopRequired />;
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex items-center justify-center bg-background p-4">
      <div
        className="flex w-full h-full overflow-hidden border border-border rounded-lg"
        style={{
          maxWidth: 1440,
          maxHeight: 880,
          minWidth: 928,
          minHeight: 588,
        }}
      >
        <div
          className="bg-card border-r border-border flex flex-col shrink-0"
          style={{ width: 400 }}
        >
          {left}
        </div>
        <div className="flex-1 bg-background flex flex-col min-w-0">
          {right}
        </div>
      </div>
    </div>
  );
}
