# Web client

React SPA for the scene-text translator demo. Built with Vite 5, React 18,
TypeScript, Tailwind CSS v3, and shadcn/ui primitives.

## Prerequisites

Node 20+. On the dev box, activate via nvm first:

```bash
export NVM_DIR=/opt/nvm && source /opt/nvm/nvm.sh
node -v   # v24+ installed; any v20+ works
```

## Scripts

```bash
npm install         # one-time
npm run dev         # Vite dev server on :5173, /api proxied to :8000
npm run build       # type-check + production bundle in dist/
npm run preview     # serve the built bundle locally
npm run type-check  # tsc --noEmit
npm run lint        # TODO: eslint config lands with Step 13
npm run test        # TODO: vitest config lands with Step 13
```

## Dev proxy

`vite.config.ts` forwards `/api/*` to `http://localhost:8000` (the FastAPI
server). This keeps the browser on a single origin so SSE streams at
`/api/jobs/{id}/events` work without CORS. Start the backend separately:

```bash
eval "$(/opt/miniforge3/bin/conda shell.bash hook)" && conda activate vc_final
cd server && python -m app.main
```

Then visit http://localhost:5173.

## Layout

- `src/main.tsx` — React root bootstrap.
- `src/App.tsx` — placeholder shell (real UI arrives in Steps 12–13).
- `src/lib/utils.ts` — shadcn's `cn()` helper.
- `src/styles/globals.css` — Tailwind directives + shadcn CSS variables.
- `components.json` — shadcn CLI config (aliases, theme, `cssVariables: true`).
