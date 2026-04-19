/**
 * <LeftColumn> — the stateless composite that frames the left half of the
 * app shell. Per plan decision D7 every app state renders the same
 * skeleton — only the passed-in slot contents change:
 *
 *     IDENTITY   (static <IdentityBlock />)
 *     FILE SLOT  (<Dropzone> or <VideoCard>)
 *     LANG SLOT  (<LanguagePair> with varying disabled/locked state)
 *     flex spacer
 *     SUBMIT     (<SubmitBar> variant)
 *
 * The component itself holds no state — the parent (`<App>`) owns every
 * transition and passes the right slot content for the current phase. That
 * keeps variant logic in one place (the state machine) rather than spread
 * across per-phase left-column components.
 *
 * <AppShell> fixes the left column to 760px tall; `h-full` here lets the
 * flex-spacer push the submit bar to the bottom regardless of how much
 * content is in the middle.
 */

import type { ReactNode } from "react";

import { IdentityBlock } from "./IdentityBlock";

export interface LeftColumnProps {
  /** Dropzone, VideoCard, or locked VideoCard depending on phase. */
  fileSlot: ReactNode;
  /** <LanguagePair> — disabled/locked driven by phase. */
  languagePairSlot: ReactNode;
  /** <SubmitBar> variant — already carries its own padding + border-top. */
  submitSlot: ReactNode;
}

export function LeftColumn({
  fileSlot,
  languagePairSlot,
  submitSlot,
}: LeftColumnProps): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <IdentityBlock />
      {/* Middle content area — scrolls if the slots overflow the fixed column
          height so the submit bar never gets pushed off-screen. */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        {fileSlot}
        {languagePairSlot}
      </div>
      {submitSlot}
    </div>
  );
}
