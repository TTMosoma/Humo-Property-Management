# 25 — Identity and hosting: the decision

Status: **decided 18 October 2026** by Terry Mosoma (product owner). Recorded as **D14** in [17-decisions.md](17-decisions.md), which supersedes D5's "not built in-house".

**What was decided:**
- **Sign-in:** ASP.NET Core Identity with passkeys (.NET 10), inside Humo's own API.
- **Hosting:** a dedicated **Webway** VPS in South Africa, with PostgreSQL on the same server.
- **Email:** an open-source mail server that Humo runs itself.

Backend slice 1 can now start (doc 24). Running all of this is Humo's job: [26-operations-and-maintenance.md](26-operations-and-maintenance.md) lists everything to maintain.

**Caveat:** prices, product features and availability change. Items marked ⚠ come from secondary sources or couldn't be confirmed on the vendor's own page. Check them before relying on them.

---

## 1. What Humo needs

| Need | Why |
|---|---|
| **Passkeys first,** plus one-time email codes or links | The sign-in page is built for this already (R-8). Customers and Humo staff never use passwords. |
| **Our own branded sign-in page** | `/sign-in` is Humo's front door. |
| **Lowest running cost** | Humo is self-funded. Owners and residents could grow to tens of thousands of users, so per-user pricing is a long-term cost. |
| **.NET integration** | The API is ASP.NET Core. |
| **POPIA** | Personal data hosted in South Africa avoids the cross-border transfer question (s72). |
| **Step-up** | A fresh passkey proof for sensitive actions (doc 03; `STEP_UP_FRESH_MS` = 5 minutes). |

## 2. The decision

### Sign-in: ASP.NET Core Identity with passkeys

**How it works:**
- **Built into .NET 10.** ASP.NET Core Identity supports passkeys (WebAuthn): registering a passkey, passwordless sign-in, and adding passkeys to an existing account.
- **Inside the API.** No separate identity server and no licence. Identities, passkeys and sessions sit in the same PostgreSQL database as the business data.
- **No passwords.** People are invited by email. They confirm with a one-time code and register a passkey. Password sign-in stays switched off.
- **Session:** a secure, HttpOnly, same-site cookie. The SPA and the API share one origin (`/api` behind the reverse proxy), so tokens never live in the browser. The cookie carries the identity and the active assignment, and switching role re-issues it (doc 24 §7).
- **Step-up:** the API asks for a fresh passkey assertion and records its time in the session. A command that needs step-up checks that time (doc 24 C7).
- **Recovery:** a lost passkey is replaced by a one-time email code plus an administrator's check. For the sole System Administrator, there is a sealed recovery procedure (doc 26 §8).
- **Humo Contractor** and future products use the same sign-in (D5 criterion 2). The API acts as the sign-in authority for all of them. If a second product needs its own server, add an OpenID Connect layer (e.g. OpenIddict, open source) on top of the same identities.

**Limits to know about:**
- **Authentication only.** Microsoft scopes the built-in feature to sign-in. It doesn't validate attestation (which authenticator model was used). Humo doesn't need that.
- **Humo owns the security.** Mitigations:
  - use only the framework's built-in flows; no home-made cryptography;
  - rate-limit sign-in and code requests;
  - give the same answer for "no account" and "no passkey" (R-8);
  - keep .NET patched every month (doc 26).
- **The passkey domain is permanent.** Passkeys are bound to the domain they were registered on (the relying-party ID). **Decided 18 Oct 2026: `pm.humo.co.za`.** Changing it later forces everyone to register new passkeys.
  - If Humo Contractor or another product later needs the same passkeys, it signs in through `pm.humo.co.za` (or an OpenID Connect layer there); it doesn't register its own.

### Hosting: Webway VPS (South Africa)

- **Provider:** Webway, a South African host.
- **VPS features:** KVM, root access, a public IPv4 address, and daily VM backups ⚠.
- **S3-compatible object storage** in South Africa ⚠, for off-server backups and uploaded files (R-11).
- **Before signing:** confirm the VPS's data centre location in writing. That makes the POPIA position "all personal data in South Africa".

**Proposed layout** (Docker Compose, so it's repeatable and documented):

| Service | Role |
|---|---|
| **Caddy** | Reverse proxy; HTTPS certificates from Let's Encrypt, renewed automatically; serves the Angular build; forwards `/api` |
| **Humo API** | ASP.NET Core (.NET 10 LTS): business API and sign-in |
| **PostgreSQL** | The database, for business data and identities |
| **Mail server** | Outbound email: sign-in codes, invitations, notices |
| **Backup job** | Nightly encrypted database dump to object storage |

**Starting size:** about 4 vCPU, 8 GB RAM, 160 GB SSD ⚠. Upgrade when monitoring shows it's needed (doc 26 §5).

**Uptime monitoring runs off the server,** so it can raise the alarm when the server itself is down (doc 26 §5).

### Email: self-hosted, open source

**Recommended: Stalwart** ⚠
- A single, lightweight server.
- Sends with SPF, DKIM and DMARC.
- Handles bounces.
- Can report delivery events, which R-5 needs.
- **Licence:** dual-licensed (AGPL-3.0 plus an enterprise licence). Check that the features we use are on the open-source side.

**Alternative: Postal** ⚠. Built for websites sending email, with delivery webhooks. It needs its own MariaDB database.

**The real risk is getting into inboxes, not the software.** Gmail and Microsoft distrust new, small mail servers, so sign-in codes could land in spam.

**To reduce the risk:**
1. **Send from a subdomain**, e.g. `notify.humo.co.za`, with its own SPF, DKIM and DMARC. Staff mailboxes at `humo.co.za` stay where they are, and their reputation is protected.
2. **Ask Webway for:**
   - outbound port 25 to be open;
   - a reverse DNS (PTR) record for the server's IP that matches the mail host name.
3. **Warm up the IP.** Send small volumes first: staff, then the pilot customer.
4. **Monitor:**
   - blacklist checks;
   - Google Postmaster Tools and Microsoft SNDS.
5. **Keep a fallback relay configured but switched off.** If inbox placement fails, the mail server forwards through a relay with a free or near-free tier. Turning it on is a configuration change, not a code change.
6. **Passkeys keep email off the daily path:** codes are only needed to join, or to recover.

### Mail settings are configuration, not code

The API sends through whatever SMTP server its settings name. Changing ports, encryption or a relay is a settings change and a restart, never a code change. The settings live in the server's `.env` (doc 26 §2):

| Setting | Example | Notes |
|---|---|---|
| `Mail__Host` | `mail.notify.humo.co.za` | Our mail server, or the fallback relay |
| `Mail__Port` | `587` | 587 with STARTTLS (recommended); 465 with implicit TLS; 25 only server to server |
| `Mail__Security` | `StartTls` | `StartTls`, `SslOnConnect` or `None` (never `None` outside the server itself) |
| `Mail__Username` / `Mail__Password` | | The API's own sending account on the mail server |
| `Mail__From` | `Humo Property Management <no-reply@notify.humo.co.za>` | |
| `Mail__ReplyTo` | `support@humo.co.za` | Replies reach people, not the sending server |
| `Mail__Relay__Enabled` | `false` | The fallback relay (§2, step 5) |

**Ports at a glance:**
- **25:** our mail server delivering to Gmail, Outlook and others (outbound). Webway must allow it.
- **587:** the API handing mail to our mail server (submission, STARTTLS).
- **465:** the same as 587, with implicit TLS, if a relay prefers it.
- **993:** only if someone reads a mailbox on the server (bounces). Otherwise keep it closed.

### Ask Webway before buying (best case to request)

Send these questions before buying, and keep the answers with doc 26. The "best case" column is what we want to hear.

| # | Ask | Best case | If not |
|---|---|---|---|
| 1 | **Where is the VPS physically hosted?** | A named South African data centre (e.g. Teraco Johannesburg or Cape Town), in writing | Ask for the city and operator at least; don't buy if the server is outside South Africa |
| 2 | **Outbound port 25 for email** | Open, or opened on request for a mail server | Use the fallback relay from day one (§2, step 5) |
| 3 | **Reverse DNS (PTR) for our IP** | They set `mail.notify.humo.co.za` for our IPv4 (and IPv6) address | Without it, Gmail and Outlook reject or spam our mail: use the relay |
| 4 | **IP reputation** | A clean, dedicated IPv4 that isn't on blocklists (check it with MXToolbox before go-live) | Ask for a different IP |
| 5 | **Backups** | Daily VM snapshots kept 7+ days, restorable by us, stored in South Africa | We rely on our own nightly backups (doc 26 §6) |
| 6 | **Object storage** | S3-compatible, in South Africa, with versioning | Use another South African provider for the off-server copy |
| 7 | **Firewall and DDoS** | A provider firewall in front of the VPS, plus basic DDoS protection | We use `ufw` only |
| 8 | **Console access** | An out-of-band console (to fix a server we've locked ourselves out of) | Be extra careful with SSH and firewall changes |
| 9 | **Resizing** | Upgrade CPU, RAM and disk without reinstalling | Size up front for a year's growth |
| 10 | **POPIA** | An operator agreement (s21) covering security measures and breach notice | Required before customer data goes on the server |
| 11 | **Support and SLA** | 24/7 support for outages, 99.9% uptime or better, local phone support | Plan our own monitoring and escalation (doc 26 §5) |

### SMS: SMSSouthAfrica, behind a configurable provider

- **Chosen provider:** SMSSouthAfrica (smssouthafrica.co.za).
- **Configurable:** the API sends through whichever provider `Sms__Provider` names. Each provider is one class (`ISmsSender`), so switching providers or adding a second one is a configuration change plus that class.
- **Until it's built:** `Log` writes messages to the log and sends nothing. The SMSSouthAfrica class exists but refuses to send until it's built from their API documentation.

## 3. Options considered (kept for the record)

Several options were compared on 18 October 2026, assuming a cloud host:
- **Hosted sign-in services:**
  - Microsoft Entra External ID (free to 50 000 monthly users ⚠, identity data in the EMEA region);
  - Amazon Cognito (Cape Town, free to 10 000 ⚠);
  - Auth0 (expensive as users grow);
  - Firebase Authentication (free, but **no built-in passkeys** ⚠ and data in the US).
- **Self-hosted identity servers:** Keycloak and Zitadel (no licence cost, but a separate service to run).

**Why ASP.NET Core Identity won, once hosting moved to a VPS:**
- no per-user cost at any scale;
- passkeys built in;
- every piece of personal data stays on the South African server;
- no second system to run;
- it fits the existing `/sign-in` page with no hosted page to restyle.

**What it costs instead:** the security and maintenance work in doc 26.

## 4. What happens next

1. **Server:**
   - send Webway the pre-purchase questions (§2, *Ask Webway before buying*);
   - order the VPS;
   - set up the PTR record;
   - set up DNS for `pm.humo.co.za` (the app) and `notify.humo.co.za` (email).
2. **Repository:** ✅ **done 19 Oct 2026** (`backend/`, see its README). It added:
   - .NET 10 solution: API, domain, EF Core with PostgreSQL;
   - Docker Compose for Caddy, the API, PostgreSQL and the mail server;
   - CI that builds and tests the API.
3. **Slice 1, step 1:** ✅ **done 19 Oct 2026** (CI for the backend still to add):
   - Identity with passkeys and email codes;
   - `GET /me` built from the session and the database;
   - the frontend sign-in calls the real endpoints instead of answering "unavailable".
4. **The rest of slice 1:** built against doc 24, port by port. Each port moves out of the "not connected" list in `provide-http-data.ts` as its endpoint lands.
5. **POPIA paperwork, alongside the build:**
   - privacy policy and terms;
   - an operator agreement with Webway;
   - a record of processing.
   - Because everything is in South Africa, no s72 transfer record is needed. Revisit this if a fallback email relay abroad is ever switched on.

## Sources

- [Passkeys in ASP.NET Core Identity (Microsoft Learn)](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/passkeys)
- [Passkey support for ASP.NET Core Identity (Andrew Lock)](https://andrewlock.net/exploring-dotnet-10-preview-features-6-passkey-support-for-aspnetcore-identity)
- [Passkeys in .NET 10 with ASP.NET Identity (Duende)](https://duendesoftware.com/blog/20251007-passkeys-in-dotnet-10-blazor-apps-with-aspnet-identity)
- [Webway.host review and plans (WHTop)](https://www.whtop.com/review/webway.host)
- [Mailcow, Stalwart and Mailu compared (WZ-IT)](https://wz-it.com/en/blog/mailcow-stalwart-mailu-comparison/)
- [Self-hosted email in 2026 (ProFor.Pro)](https://profor.pro/blog/self-hosted-email-2026-mailcow-stalwart-mailu/)
- [Stalwart alternatives and deliverability (TrekMail)](https://trekmail.net/blog/stalwart-alternative)
- [POPIA cross-border transfers (CMS)](https://cms.law/en/zaf/legal-updates/Managing-cross-border-data-transfers)
