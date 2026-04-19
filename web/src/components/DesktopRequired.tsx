/**
 * <DesktopRequired> — static info card shown when the viewport is smaller
 * than the app shell's 960 × 620 px floor. No CTA — the only fix is for the
 * user to widen / tallen their browser window. Rendered as a replacement
 * for <AppShell>, not wrapped by it (see <AppShell>'s viewport guard).
 */

import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function DesktopRequired(): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <Card className="max-w-md w-full">
        <CardHeader>
          {/* Real <h2> rather than shadcn's <CardTitle> (which renders a
              div) so assistive tech + getByRole("heading") land on it. */}
          <h2 className="text-2xl font-semibold leading-none tracking-tight">
            Desktop required
          </h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Scene Text Translator needs at least 960 × 620 px of window space.
            Please open this page in a wider browser window (or close side
            panels / dev tools).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
