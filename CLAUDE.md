# Humo Property Management: working notes for Claude

Humo Property Management ("Humo PM") is a platform for managing agents who run community schemes. The repo holds the Angular prototype (`frontend/humo-web`), the .NET 10 API (`backend/`), shared contracts (`contracts/`) and demo data (`demo-data/`). Read [README.md](README.md) for the layout and [docs/17-decisions.md](docs/17-decisions.md) for the approved decisions (D1–D15) before changing behaviour.

## Naming

- Say "Humo Property Management" or "Humo PM" for this application. Keep a bare "Humo" for platform-level things (Humo identity, Humo security, Humo Support).
- Humo Valuations and Humo Contractor are separate products, never modules in Humo PM's navigation.
- See [docs/07-brand-architecture.md](docs/07-brand-architecture.md).

## Decisions

- Decisions are approved in [docs/17-decisions.md](docs/17-decisions.md). To change one, add a new entry that supersedes it. Don't edit history.
- Access is by assignment (D1), trustee access comes from the board register (D2), roles are fixed and every check is by permission (D4), and sign-in is ASP.NET Core Identity with passkeys inside Humo's API (D14).
- The frontend and backend share `contracts/role-permissions.json` and `contracts/entitlements.json`. Each side has a contract test that fails on drift. Change both sides together.

## Simulated actions: the readiness register

The frontend is a prototype. Anything it simulates is listed in [docs/18-production-readiness-register.md](docs/18-production-readiness-register.md) and tagged in code:

- a port method in the frontend data layer carries a `PRODUCTION:` comment that says what the real implementation must do;
- the in-memory adapter carries `SIMULATED (docs/18 R-n)`.

Find them with:

```bash
grep -rn "docs/18" frontend/humo-web/src
```

Rules:

- Anything new that simulates an outside effect (email, SMS, payment, file, notification to another product) gets a register entry and both tags.
- An item is closed only when the real implementation is live **and** its tags are removed. Move closed items to the "Closed items" table with the date.
- Don't add a toast or a local-only state change where the backend should exist. Add the port method and the endpoint.

## Backend

- .NET 10, clean layers: `Humo.Api` (endpoints, command runner, sign-in), `Humo.Domain` (roles, permissions, rules), `Humo.Infrastructure` (EF Core and PostgreSQL, email, SMS, payments, documents).
- Commands run through `CommandRunner`, which saves changes and then sends the queued notices by email. A failed email never undoes the change; it is logged (docs/26 §8).
- Every command checks the target record's organisation and scheme. A `schemeIds` parameter from the client is only a filter within the user's scope.
- The audit log is append-only.
- Database changes need a migration (see [backend/README.md](backend/README.md)). Back up before running migrations in production (docs/26 §9).

## Frontend

- Angular 22 with Ionic 8. Use the existing data-source ports, not direct HTTP calls from components.
- Feature flags only hide screens. The API must enforce the same rule.
- Calendar dates are South African dates. The tests run with `TZ=Africa/Johannesburg`.

## Commands

Backend:

```bash
dotnet test backend
```

Frontend (from `frontend/humo-web`, Node 24):

```bash
npm ci
npm run typecheck
npm run lint
TZ=Africa/Johannesburg npm test
npm run build
npm run build:demo
npm run build:contractor
```

Local services for the API (PostgreSQL on port 55432 and Mailpit on 8025):

```bash
docker compose -f backend/deploy/docker-compose.dev.yml up -d
```

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every pull request and on `main`. Before opening a PR, make sure these pass locally:

- frontend typecheck, lint, tests and the three builds;
- `dotnet build` and `dotnet test` for the backend.

The production build must not contain demo data (`docs/18` R-6). CI fails if it does.

## Git

- Work on a branch and open a pull request into `main`. Don't commit straight to `main`.
- Commit messages describe the change in the imperative and name the slice or register item when there is one (for example, "Slice 2d: credit control on the API").
- Doc updates go in the same change as the code they describe. A slice updates its feature doc (for example, docs 11 and 18 for billing and the register) and [docs/08-api-contract.md](docs/08-api-contract.md) when endpoints change.
