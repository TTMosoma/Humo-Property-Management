# Humo frontend workspace

An Angular 22 workspace with **two separate applications**:

| Project | Product | Source | Dev server | Build output |
|---|---|---|---|---|
| `humo-web` | **Humo Property Management**: the UI prototype (Angular + Ionic, mock data, no backend) | `src/` | `npm start -- --port 4310` | `dist/humo-web/browser` |
| `humo-contractor` | **Humo Contractor**: a minimal foundation (one landing screen) | `projects/humo-contractor/src/` | `npm run start:contractor` (port 4320) | `dist/humo-contractor/browser` |

The two apps share installed packages and the base `tsconfig.json`, nothing else. Neither imports the other, and each runs and builds on its own. Details are in `../../docs/20-humo-contractor-separation.md`.

## Install

```bash
npm install
```

## Humo Property Management

```bash
npm start -- --port 4310     # dev server: http://localhost:4310
npm run build                # production build
npm run build:demo           # production build + demo hosting files (docs/19-demo-deployment.md)
```

## Humo Contractor

```bash
npm run start:contractor     # dev server: http://localhost:4320
npm run build:contractor     # production build
```

## Checks

```bash
npx tsc -p tsconfig.app.json --noEmit                            # Humo PM types
npx tsc -p projects/humo-contractor/tsconfig.app.json --noEmit   # Humo Contractor types
```

## Tests

```bash
npm test                     # Humo PM unit tests (Vitest, via ng test)
```

They're in `src/**/*.spec.ts`, starting with account creation and approval (`docs/21`). There's no linter yet (remediation plan P1-1).
