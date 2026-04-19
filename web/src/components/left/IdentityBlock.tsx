/**
 * <IdentityBlock> — the static title + tagline pinned to the top of the left
 * column. Trivial presentational component; no props, no variants. Renders a
 * real <h1> so the left column contributes a landmark-level heading to the
 * accessibility tree (as opposed to shadcn's <CardTitle>, which is a div).
 *
 * Padding lines up with the rest of the left column's chrome so the title
 * aligns with the border-right + with the identity strip in the mockup.
 */

export function IdentityBlock(): JSX.Element {
  return (
    <section aria-label="App identity" className="px-6 pt-6">
      <h1 className="text-lg font-semibold tracking-tight text-foreground">
        Scene Text Translator
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Replace on-screen text across languages.
      </p>
    </section>
  );
}
