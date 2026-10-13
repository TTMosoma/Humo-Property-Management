# 04 — The Humo platform layer: roles, entitlements, account health and nudges

Status: **Implemented in the frontend prototype (mock data).** Decisions marked ⚑ need product-owner approval.

**Update, 12 October 2026:** pricing, client agreements, storage quotas, billing preferences and simulated invoices and payments are now built: see [23-commercial-management.md](23-commercial-management.md). Packages and features below are unchanged; add-ons are now catalogue data, and a customer's package and add-ons in force come from their agreement.

**Humo Property Management** is the product customers use. **Humo** is the business that operates it. This document covers the Humo side:
- the internal roles
- what customers can use (entitlements)
- how customers are doing (Account Health)
- how Humo helps them get more from the product (opportunities and Smart Nudges)

---

## 1. Internal roles

| Role | Purpose | Can | Deliberately cannot |
|---|---|---|---|
| **Humo System Administrator** | Operate the platform | Customers, subscriptions, the package catalogue, Humo roles, configuration, feature flags, audit | Impersonate unless individually granted `System.Impersonate` |
| **Humo Account Manager** | The customer relationship | Request new customer accounts (approved by a System Administrator, or activated directly with an individual delegated-activation grant: doc 21), onboard and configure customers, assist users, review health and adoption, work opportunities and requests, change subscriptions **for their own accounts** (with step-up) | Platform configuration, the package catalogue, Humo roles |
| **Humo Support** | Investigate and help | View customer context, users, logs (audit), help with troubleshooting and recovery | Change packages or subscriptions, change configuration or security policy, grant themselves access |
| **Humo Executive** | Business intelligence | Executive dashboard, customers, revenue, health (read-only aggregates) | Change permissions, configuration, settings or subscriptions; see customer users or audit detail |

**Where it's defined:**
- **Permissions:** `domain/models/permission.ts` (`Platform.*`).
- **Home screens:**
  - Executive → Business overview
  - Account Manager → My accounts
  - System Administrator and Support → Customers

**Each role has its own look and feel:**
- **Executive:** a dark "command centre" (strategic, minimal).
- **Account Manager:** warm, customer-first cards: "Needs you" and "Worth a conversation".
- **System Administrator:** technical. Customer ids, status, seats and every control.

## 2. Entitlement architecture

```
Customer → Subscription → Package (+ inherited tiers) → Base entitlements → Add-ons → Overrides → Effective entitlements
```

| Concept | Model | Notes |
|---|---|---|
| **Feature** | `Feature`, `FEATURES` | ~40 features, grouped into modules. Audit log and passkeys are **baseline**: security is never sold as an upgrade. |
| **Package** | `Package`, `PACKAGES` | Essentials → Professional (extends Essentials) → Enterprise (extends Professional). |
| **Add-on** | `AddOn`, `ADD_ONS` | Governance, Advanced Reporting, Storage, API Access, WhatsApp, Advanced Automation, Integrations. |
| **Feature override** | `FeatureOverride` | A trial or goodwill grant (with expiry), or switching a feature off. Always has a reason. |
| **Subscription** | `Subscription` | Package, status, add-ons, overrides, recorded MRR and seats. |
| **Entitlement** | `Entitlement`, `EntitlementSet` | The effective answer, with its source: "Humo Professional", "Governance add-on", "Granted until 31 Oct". |

**`resolveEntitlements(subscription)`** is the single, pure entitlement engine:
- **Order:** package (with inheritance), then add-ons, then unexpired overrides.
- **Suspended or cancelled subscriptions** keep only the baseline features.

**How the app asks:**
- Code asks only **`session.hasFeature('governance')`**.
- Nothing in the codebase asks which package a customer is on.
- Navigation, the route guard and the mock API (`MockGateway`, `feature` check, `not-entitled`) all ask the same question.

**Customers can ask, not enable:**
- In **Settings › Plan & features**, administrators press "Ask Humo about Governance".
- This creates an `UpgradeRequest` for their Account Manager. Nothing is switched on or billed.

**Managing entitlements (Account Manager or System Administrator):**
- **Where:** Customer › Subscription & features › **Manage features**.
- **What:** change package, toggle add-ons, grant time-limited trials or overrides.
- **Controls on every change:**
  - It needs a reason.
  - It needs a fresh step-up (`change-subscription`).
  - It is audited.
  - Account Managers can change only their own accounts.

## 3. Account Health architecture

```
UsageSnapshot (analytics) → calculateHealth(snapshot, entitlements, weights) → AccountHealth { score, band, signals[], modules[], history }
```

**Signals and weights** (`DEFAULT_HEALTH_WEIGHTS`, which sum to 100%):

| Signal | Weight |
|---|---|
| Active users | 18% |
| Sign-in activity | 10% |
| Feature adoption | 20% |
| Workflow completion | 14% |
| Support issues | 10% |
| Subscription utilisation | 10% |
| Payment status | 10% |
| Dormant areas | 8% |

**Bands:** 75 and above is Healthy; 50–74 is At risk; below 50 is Critical.

**Explainable:**
- Each signal carries its own score, weight and plain-language reason, so the customer page shows *why* an account is at risk.
- **Module adoption** compares activity with what an agency of that size usually does.
- For modules that aren't enabled, the same measure is a **demand signal**, for example Tshikrand's 12% Governance activity without Governance.

**Tshikrand example** (mock, but computed by the real formula):
- Health **87**
- Portfolio 92%, Finance 96%, Maintenance 88%, Documents 71%
- Governance not enabled, with 12% demand

## 4. Opportunities and the flywheel

`OPPORTUNITY_RULES` are pure detectors run over (snapshot, entitlements, subscription, health):

| Rule | Fires when | Example |
|---|---|---|
| `governance-addon` | Governance off · more than 5 trustees · 6+ meetings a year · governance-like activity elsewhere | Tshikrand: **HIGH** (8 trustees, 14 meetings a year, Governance not enabled) |
| `advanced-reporting-addon` | Advanced reporting off · 10+ report exports a month · finance adoption 70%+ | Tshikrand: **MEDIUM** |
| `professional-upgrade` | Essentials · 600+ units | |
| `underused-feature` | An enabled module below 25% adoption | Customer success (**training, not sales**) |

The same rule ids feed both audiences:
- **Account Managers** see each opportunity with its reasons and a suggested human opener ("a reason to talk, not a sales script").
- **Smart Nudges** use the rule as their trigger.

```
Customer uses Humo → usage analytics → Account Health → opportunity detected → Account Manager / Smart Nudge → customer asks or upgrades → more features → more usage
```

**How the loop is wired, with no single component owning it:**
- `PlatformStore` holds subscriptions, usage snapshots, requests and nudge history.
- Health, opportunities and the business overview are **computed** from these with the domain functions.
- Changing an add-on immediately changes entitlements. Nudges for features the customer now has retire for good.

## 5. Smart Nudge architecture

| Concept | Model |
|---|---|
| **Definition** | `NudgeDefinition`: trigger (rule + minimum strength), add-on, placements, audience roles, copy with `{usage}` placeholders, destination, policy |
| **Frequency policy** | `NudgePolicy`: if ignored, wait 30 days · if dismissed, suppress 90 days · "Not interested", never again · converted, retired for good. Configurable per nudge. |
| **State** | `NudgeState` per person: shownAt[], dismissedAt, snoozedUntil, notInterestedAt, learnMoreAt, convertedAt |
| **Decision** | `evaluateNudge(def, state, opportunities, now)`: a pure function, run by the server (`NudgeDataSource.next(placement)`) |

**Where they show:** Tasks, Jobs and Payables.

**Rules:**
- At most **one nudge per session**.
- Never while impersonating.
- Only for roles that can act on it, or ask their administrator.

**The card:**
- Says what the customer's own usage shows ("Your team has processed 42 maintenance requests this month…"), then the suggestion.
- Offers **Explore**, **Not interested**, **Dismiss** and **Why am I seeing this?**
- Explore leads to Plan & features, which leads to a request. A conversion retires the nudge.

## 6. Executive dashboard

Platform › Business overview (Humo Executive; also System Administrator):

| Area | Contents |
|---|---|
| **KPIs** | MRR R 1 840 000 · ARR R 22 080 000 · 184 customers · 3 842 schemes · 182 400 units · 8 214 active users · 96.2% retention. These add up from the customer book; they are not typed in. |
| **Revenue** | MRR trend, ARR, expansion, net revenue retention, revenue by package |
| **Customer growth** | New and churned customers by month, logo retention |
| **Account health** | Healthy / at risk / critical, MRR needing attention, largest at-risk accounts |
| **Product adoption** | Share of entitled customers actively using each module |
| **Expansion** | Likely to upgrade, customers showing demand for features they don't have, customers under-using their package, top opportunities |

## 7. Screens and navigation

| Screen | Route | Who |
|---|---|---|
| Business overview | `/platform/executive` | Executive, System Administrator |
| My accounts | `/platform/accounts` | Account Manager |
| Customers | `/platform/customers` | All Humo roles (columns by permission) |
| Customer 360 | `/platform/customers/:id` | All Humo roles (health, opportunities, subscription; actions by permission) |
| Packages & features | `/platform/packages` | System Administrator, Account Manager, Executive |
| Pricing & add-ons | `/platform/pricing` | Humo staff with `Platform.Revenue.View`; edits by System Administrator (doc 23) |
| Customer › Billing & agreement | `/platform/customers/:id?view=commercial` | Humo staff with `Platform.Revenue.View`; changes by permission (doc 23) |
| Feature flags | `/platform/flags` (planned) | System Administrator |
| Plan & features | `/settings/plan` | Customer staff (only administrators can ask Humo) |

**Retired routes:** `/platform/agencies` and `/platform/plans` now redirect.

## 8. Backend-only (later)

- **Usage pipeline:**
  - event capture
  - daily `UsageSnapshot` per customer
  - running `calculateHealth` and opportunity rules on schedule, with history
- **Entitlements:**
  - stored subscriptions
  - entitlement resolution as an API service
  - per-request entitlement checks
  - override expiry jobs
  - feature flags kept separate from entitlements
- **Billing system:** pricing, agreements, invoices and payments are now modelled and simulated in the frontend (doc 23). The payment provider, real invoicing and storage enforcement are backend work (register R-12 to R-14). MRR is the agreement's recurring total; existing customers' agreements carry their recorded contract value.
- **Nudges:** server-side state, rules editable by System Administrators, measuring conversions.
- **CRM-style records:** Account Manager assignment, request workflow and notifications.
- **Data access:** an Executive data-access policy enforced in the API, returning aggregates only.

## 9. Decisions for approval ⚑

1. **Account Managers can change subscriptions, but only for their own accounts, with step-up.** The alternative is to give them requests only, leaving changes to System Administrators.
2. **Security features are in every package** (audit log, passkeys, Humo Mobile).
3. **Example customer:** Acacia (the demo agency) and Tshikrand are both on **Professional without Governance**. That means Compliance and Governance navigation are hidden for Acacia until the Governance add-on is added. Slice C (trustee meetings) will need the add-on or Enterprise.
4. **Customers see their own plan but not Humo's health or opportunity data.**
5. **Nudge copy and placements**, and the default frequency policy (30 / 90 / never).
6. **Health weights and band thresholds.**
7. **Package contents** as listed. These are initial definitions, not pricing.
