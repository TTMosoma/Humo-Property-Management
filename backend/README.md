# Humo API (backend)

The .NET 10 API behind Humo Property Management.
- **Decisions:** D14 in [docs/17](../docs/17-decisions.md), and [doc 25](../docs/25-identity-and-hosting-options.md).
- **Running it in production:** [doc 26](../docs/26-operations-and-maintenance.md).
- **What each endpoint must do:** [doc 24](../docs/24-slice-1-acceptance-criteria.md).

**Slice 1, step 1 (this code):**
- **Sign-in:** passkeys and one-time email links, with no passwords. ASP.NET Core Identity, schema v3.
- **`GET /api/me`:** the session the frontend renders.
- **Role switching** and **sign-out.**
- **The first System Administrator,** created from configuration.
- **The audit log,** which is never edited.
- **Email over SMTP** and **SMS behind a configurable provider.**

The rest of slice 1 follows port by port: organisations, schemes, units, people, access and impersonation.

## Layout

| Folder | What's in it |
|---|---|
| `src/Humo.Api` | Endpoints, sign-in, the session (`/me`), audit, start-up |
| `src/Humo.Domain` | Roles and permissions, read from [`contracts/role-permissions.json`](../contracts/role-permissions.json), the same table the frontend uses |
| `src/Humo.Infrastructure` | PostgreSQL (EF Core), Identity, email (MailKit) and SMS providers |
| `tests/Humo.Api.Tests` | API tests against the real app, with in-memory SQLite (no Docker needed) |
| `deploy/` | Docker Compose for development and production, the Caddyfile, `.env.example` |

## Run it locally

**Prerequisites:**
- the .NET 10 SDK;
- Docker Desktop;
- Node 24, for the frontend.

**Steps:**
1. **Start PostgreSQL and Mailpit.** Mailpit catches every email; nothing leaves your machine.
   ```bash
   docker compose -f backend/deploy/docker-compose.dev.yml up -d
   ```
   PostgreSQL runs on port **55432**, because this machine already runs PostgreSQL on 5432 and 5433. Mailpit's inbox is at http://localhost:8025.
2. **Run the API.** It runs on http://localhost:5080, applies migrations on start, and invites the first System Administrator from `appsettings.Development.json`.
   ```bash
   dotnet run --project backend/src/Humo.Api
   ```
3. **Run the frontend against it.** This uses the production data layer, with `/api` proxied to `:5080`.
   ```bash
   npm --prefix frontend/humo-web run start:api
   ```
4. **Sign in:**
   1. Open http://localhost:4310 and enter the bootstrap address (development: `terry@humo.co.za`).
   2. Choose **Email me a sign-in link**.
   3. Open the link from Mailpit.
   4. Create a passkey when asked. Next time, use **Sign in with a passkey**.

## Tests

```bash
dotnet test backend
```

**Two-way contracts:**
- The frontend's `role-permissions-contract.spec.ts` fails if `contracts/role-permissions.json` drifts from the frontend's roles.
- Its `entitlements-contract.spec.ts` fails if `contracts/entitlements.json` drifts from the frontend's features and packages.
- The API reads both files.

## Database changes

Migrations live in `src/Humo.Infrastructure/Data/Migrations`. To add one:

```bash
cd backend
dotnet tool restore
dotnet ef migrations add <Name> -p src/Humo.Infrastructure -s src/Humo.Api -o Data/Migrations
```

The API applies pending migrations when it starts (`Database:Initialise=Migrate`). **Back up first in production** (doc 26 §9).

## Configuration

Settings come from `appsettings.json`, then environment variables. In an environment variable, a double underscore separates sections, e.g. `Mail__Port=587`.

| Setting | Meaning |
|---|---|
| `ConnectionStrings__Humo` | PostgreSQL connection |
| `App__PublicUrl` | `https://pm.humo.co.za`. Sign-in links point here. |
| `App__PasskeyDomain` | `pm.humo.co.za`. **Never change it in production:** every passkey is bound to it. |
| `App__AllowedOrigins__0` | Origins a passkey ceremony may come from |
| `Bootstrap__AdminEmail` / `__AdminName` | The first System Administrator (`@humo.co.za`), invited once on an empty database |
| `Mail__Provider` | `Smtp`, or `Log` (development: write to the log) |
| `Mail__Host` / `__Port` / `__Security` / `__Username` / `__Password` / `__From` / `__ReplyTo` | The mail server. `Security`: `StartTls` (587), `SslOnConnect` (465), `None` (local only) |
| `Mail__Relay__*` | The fallback relay; `Mail__Relay__Enabled=true` switches to it (doc 26 §8) |
| `Sms__Provider` | `Log` (nothing is sent), or a provider name such as `SmsSouthAfrica` |
| `Sms__SenderId` | The sender name recipients see, where the networks allow it (at most 11 characters) |
| `Sms__SmsSouthAfrica__ClientId` / `__ApiSecret` | SMSSouthAfrica API key (their control panel: Settings › API Keys) |
| `Sms__SmsSouthAfrica__TestMode` | `true`: the API answers but nothing reaches a phone or is charged |
| `Sms__SmsSouthAfrica__WebhookSecret` | The signature secret for delivery reports (Settings › Webhooks › Activate Signatures) |

## SMS providers

**How it works:**
- Every provider implements `ISmsSender` (`src/Humo.Infrastructure/Messaging/`).
- `Sms__Provider` chooses one by name, and an unknown name fails loudly.
- Adding a provider means:
  1. one class;
  2. registering it in `InfrastructureServices`;
  3. its own settings section, `Sms__<Name>__*`.

**SMSSouthAfrica** (`SmsSouthAfrica.cs`) uses their REST API, MyMobileAPI v3: https://mymobileapi.readme.io.

**Sending:**
- `POST https://rest.mymobileapi.com/v3/BulkMessages` with Basic authentication (Client ID and API secret).
- Numbers are sent as `27…` ("082 123 4567" becomes `27821234567`), and landlines are refused.
- Humo's own reference goes in `customerId`, so delivery reports match back.
- The receipt's provider id is their `eventId`.

**Delivery reports and replies:**
- They arrive at `POST /api/webhooks/sms/smssouthafrica`.
- Each must carry a valid `SmsWebhookEngine-Signature`: HMAC-SHA256 over `v1:{timestamp}|{METHOD}|{url}|{body}`, using the base64 secret.
- Reports older than 5 minutes are refused.
- For now they're logged. Storing them in Sent comes with the communications slice (docs/18 R-5).

**Setting it up:**
1. In their control panel, create an API key (Settings › API Keys) and enable the REST API channel.
2. Put the Client ID and secret in `.env`, with `SMS_SOUTHAFRICA_TEST_MODE=true`.
3. Add the webhook (Settings › Webhooks):
   - URL: `https://pm.humo.co.za/api/webhooks/sms/smssouthafrica`;
   - choose delivery receipts and replies;
   - activate signatures;
   - paste the secret into `.env`.
4. Send a test message in test mode. Then set `SMS_SOUTHAFRICA_TEST_MODE=false` and `SMS_PROVIDER=SmsSouthAfrica`.

## Production

See `deploy/docker-compose.yml`, `deploy/Caddyfile` and `deploy/.env.example`, and follow doc 26 for set-up, backups and maintenance.

The API's image is built from the repository root, because it embeds `contracts/`:

```bash
docker build -f backend/Dockerfile -t humo-api .
```
