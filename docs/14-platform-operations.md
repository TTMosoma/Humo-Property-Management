# 14 — Platform operations (Checkpoint 9)

Status: **implemented in the frontend simulation** (October 2026).

What Humo's own team uses to run the platform: **feature flags**, **platform health** and **system settings**. These were the last pages tagged for Checkpoints 8–9. Humo staff only.

## 1. Feature flags (`/platform/flags`)

**Flags and entitlements are different things.**
- **Flags are technical:** is this code switched on, where, and for whom?
- **Entitlements are commercial:** has the customer paid for it? (Packages & features)
- **Both must allow a feature** before a customer sees it.

| Concept | Detail |
|---|---|
| **Environments** | Development · Staging · Production. The prototype's data stands for production. |
| **Rule per environment** | On/off; rollout % of customers; *always on for* (allow) and *never on for* (deny) lists. |
| **Evaluation** | Deny wins, then allow, then a stable bucket: a hash of flag and customer, 0–99, compared with the rollout %. The same customers stay in as a rollout grows. (`evaluateFlag()` in `domain/models/ops.ts`.) |
| **Kinds** | Release · Kill switch · Operational · Experiment. |
| **Changes** | Need a reason, are kept in the flag's history and the audit log, and in production need a fresh step-up (`change-platform-config`). |
| **Delivery** | `GET /me/flags` returns every flag evaluated for the caller's organisation, as part of the session bootstrap. Screens use `FeatureFlags.on(key)`; the API checks server-side flags itself. |

**The flags in the seed, and what they really switch:**

| Flag | Kind | Production | Effect in the app |
|---|---|---|---|
| `dashboard.since-yesterday` | Release | 50% + Acacia | Dashboard › Since yesterday |
| `mobile.report-tab` | Release | 25% + Acacia | Phone tab bar › Report |
| `reports.csv-export` | Release | Everyone | Reports › Export CSV |
| `notifications.resident-live` | Release | Everyone | Residents' live notifications (checked server-side) |
| `channels.whatsapp` | Kill switch | On | Off: notices skip WhatsApp, and the WhatsApp integration shows *Paused* |
| `billing.statement-sending` | Kill switch | On | Off: *Send statements* is refused ("Humo has paused statement sending"). Posting still works. |
| `billing.correction-runs` | Release | Off | Not built: on in development and staging only |
| `ops.bank-feed-v2` | Operational | 10% | Informational |

**Flag page:**
- **Rules per environment:** each one shows how many customers it reaches now, with *Change*.
- **Kill switches:** a one-click *Switch off everywhere* (needs a reason and step-up).
- **Check a customer:** shows on or off for one customer, and why, including their rollout bucket.
- **History:** every change, with its reason.

## 2. Platform health (`/platform/health`)

`Platform.Operations.View` (System Administrator, Humo Support). Actions need the new `Platform.Operations.Manage` permission (same roles).

| Section | Source |
|---|---|
| **Status line** | Degraded integrations and kill switches that are off. |
| **Tiles** | Availability (30 days), p95 response time, server error rate, open incidents. |
| **Response time** | A 24-hour p95 chart. |
| **Integrations** | Humo API, email, SMS, WhatsApp, bank feeds (FNB, Nedbank), card and instant EFT, document rendering, Humo Contractor. Each has a 30-day uptime strip. Status comes from open incidents, failing jobs and kill switches. |
| **Background jobs** | Bank imports, billing run calculation, statement delivery, notification dispatch, compliance check, backup. Billing and statement runs are the simulation's own runs. Expand a job for its run history; *Retry* a failed one. |
| **Incidents** | *Declare incident* (title, impact, affected services, first update). *Post update* (investigating → identified → monitoring → resolved). Affected services show as degraded until it's resolved. |

**Seed data:**
- **Nedbank import:** failing (timeouts); *Retry* recovers it.
- **INC-0042:** SMS delays, open.
- **INC-0041 and INC-0040:** resolved.

## 3. Settings › System (`/settings/system`)

`Platform.Config.Manage`. Every change needs a reason and step-up.

- **Scheduled maintenance:** a message and a window. Every signed-in user, Humo or customer, sees a banner (`MaintenanceBanner` in the shell) until the window ends.
- **Policy:**
  - **Largest upload:** enforced by document uploads.
  - **Session timeout**, **staff sign-in (passkeys only)** and **audit retention:** recorded for the API to enforce. Audit retention is at least 5 years.

## Also fixed

- **Unregistered icon:** `attach-outline` (meeting papers, since Checkpoint 5).
- **Multi-choice field:** the form drawer has a `checks` field type (several options, comma-joined value), with a group rather than a nested label. It also accepts `datetime-local`.
- **Step-up action:** a new `change-platform-config` sensitive action. Flag and system changes use it, so the step-up dialog no longer says "Change security settings".

## Walkthrough

1. **Reset the simulation**, then sign in as **Terry Mosoma** (Humo System Administrator).
2. **Feature flags** → *Statement sending* → *Switch off everywhere* (reason, step-up). The history records it, and Platform health lists it as switched off.
3. **Platform health:**
   - *Retry* the Nedbank import; the bank feed recovers.
   - On INC-0042, *Post update* → Resolved; SMS turns operational.
4. **Settings › System** → *Schedule* maintenance. Sign in as Johan: the banner is there.
5. **Feature flags** → *Dashboard: since yesterday* → *Check a customer*. Then change production to exclude Acacia; Johan's dashboard loses the section.

## Known gaps

- **Not tested end to end:**
  - excluding a customer from a flag;
  - WhatsApp being skipped on a notice;
  - *Send statements* being refused while its kill switch is off.

  The code paths are in place and type-check.
- **Health figures:** availability, latency and integration uptime are simulated. Billing and statement jobs come from the simulation's own activity.
- **Not built:** per-environment deployment of flag *definitions* (adding or removing flags) is a code change, not a screen.
- **Bundle size:** the initial bundle is 1.27 MB, 70 kB over the 1.2 MB warning budget (the error limit is 2 MB). The cause is the simulated data layer loading at startup, as in Checkpoints 7–8.
