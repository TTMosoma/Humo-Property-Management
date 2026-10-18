# 07 — Brand architecture: Humo and Humo Property Management

```
HUMO — property technology platform (the product family)
├── Humo Property Management   — this application ("Humo PM")
├── Humo Valuations            — future, separate product
├── Humo Contractor            — separate product: its own app (projects/humo-contractor), a foundation only
└── future Humo products
```

| Concept | Example | In code |
|---|---|---|
| Product family / platform | Humo | `HUMO_FAMILY` (`core/product/product.ts`) |
| Application | Humo Property Management | `PRODUCT`, `HUMO_PRODUCTS` |
| Organisation (customer) | Marula Property | `Organisation` (the UI says "Agency") |
| User | Sarah Jacobs | `Identity` |
| Role | Portfolio Manager | `RoleAssignment.role` |
| Scope / context | Oakwood Estate | `RoleAssignment.schemeIds`, `ScopeService` |
| Package | Humo Professional | `Package` — now carries `product: 'property-management'` |
| Feature entitlement | Governance | `Feature`, `EntitlementSet` |

## Where the product name appears

| Place | Shows |
|---|---|
| Browser tab | `{Page} · Humo Property Management`, or `Humo Property Management` alone (`HumoTitleStrategy`) |
| Humo Contractor app | `Humo Contractor`: it's another product (its own app since 11 Oct 2026), so it doesn't take PM's name |
| `index.html` | Title "Humo Property Management"; description with the tagline |
| Web app manifest | `name`: Humo Property Management; `short_name`: **Humo PM** (was "Humo") |
| Sidebar | Humo wordmark + "Property Management"; accessible name and tooltip "Humo Property Management — One platform. Every scheme. Everything managed." |
| Dashboard | Eyebrow "HUMO PROPERTY MANAGEMENT" above the greeting |
| Logo, colours, layout | **Unchanged.** This is a naming correction, not a rebrand. |

## Final review of "Humo" references

**1. Correct platform-level usage (kept as "Humo"):**
- **Humo staff roles:** Humo System Administrator, Humo Account Manager, Humo Support, Humo Executive. These are platform and business roles across every Humo product.
- **Identity and security:** "One Humo sign-in / identity", "How you sign in to Humo", "When Humo asks again", Humo Mobile, and the step-up text "Humo asks again for actions that…".
- **Humo the company:**
  - "Ask Humo about Governance", "your Humo account manager", "Request a feature or upgrade from Humo"
  - "Humo refuses every change" (the Observe policy)
  - "Humo never sells safety as an upgrade"
  - "customer asked Humo to correct…"
  - organisation label "Humo" for platform staff
- **The Humo platform:** Platform console, platform audit, "Humo platform", the Humo business layer, and Executive figures such as "units on Humo" and "Customer uses Humo" (ecosystem-wide).
- **The contractor network** (Humo-wide, not PM): "Humo endorsements", "on Humo since", "Humo checked / reviews / confirms", "Insurance verified by Humo", "Message through Humo", "Humo Recommended".
- **The Humo design system and brand:** the Humo logo, the "Humo leaf", "the standard Humo table", Humo illustrations.
- **Package names:** Humo Essentials / Professional / Enterprise, the product names given in the brief. Packages are now scoped to the PM product in the model.

**2. Correct Humo Property Management usage (added or corrected):**

| Was | Now |
|---|---|
| Tab title `… · Humo` | `… · Humo Property Management` |
| Manifest short name "Humo" | "Humo PM" |
| "Runs the agency on Humo" (role summary) | "…in Humo Property Management" |
| "Everyone who can sign in to {agency} on Humo" | "…in Humo Property Management. One person, one Humo sign-in…" |
| "How access works on Humo" (Roles & permissions) | "How access works in Humo Property Management" |
| "What {agency} has on Humo" (Plan & features) | "…has in Humo Property Management" |
| "next time they open Humo" | "…open Humo Property Management" |
| "You'll see Humo exactly as they do" (impersonation) | "You'll see Humo Property Management exactly as they do" |
| "…and Humo builds the rest" (first scheme) | "…and Humo Property Management builds the rest" |
| "every attachment in Humo" (Documents) | "every attachment in Humo Property Management" |
| "related activity elsewhere in Humo" (adoption) | "…in Humo Property Management" |
| Nudge "You're getting more out of Humo" | "…out of Humo Property Management" |
| "receipts handled outside Humo" (opportunity) | "…outside Humo PM" |
| "Programmatic access to Humo data" (API feature) | "…Humo Property Management data" |
| System actor "Humo" in job and receipt history | "Humo PM" (automatic actions of this application) |
| "Request quotes through Humo", "Humo quote request", "Reputation on Humo", "Endorse on Humo" | "…through **Humo Contractor**", "Humo Contractor quote request", "Reputation on Humo Contractor", "Endorse on Humo Contractor". The quote network is a separate product. |
| Code comments (work items, entitlements, health, opportunities, impersonation) | Say "Humo Property Management" where they meant the app |
| Docs 02, 03, 05 | Same corrections |

**3. Incorrect ambiguous usage remaining:** none found in the final scan.

## Left unchanged on purpose (to avoid breakage)

- **Folder and Angular project `frontend/humo-web`, project name `humo-web`.** Renaming touches `angular.json`, `package.json`, the dist path, `.claude/launch.json` and the docs.
  - Recommended: rename to `frontend/humo-property-management-web` (or `Humo.PropertyManagement.Web`) when the .NET solution is created, in one dedicated commit.
- **Class names `HumoTitleStrategy` and the `Humo*Role` types, and the CSS prefix `humo-`.** These are platform-level or design-system names and correct as they are.
- **Storage keys `humo.*`** (persona, scope, nudges). These are platform-level, and renaming them would reset prototype state.
- **Routes.** No route changes: `/platform/*` holds Humo staff tools. (`/contractor` was removed on 11 Oct 2026, when Humo Contractor became its own app.)
- **Repository name `Humo-Property-Management`.** Already correct.

## Recommendations for multi-product support

1. **Product switcher outside the apps.**
   - A Humo launcher (identity-level) reads `HUMO_PRODUCTS` filtered by the user's product entitlements.
   - Each product keeps its own shell. Don't add a product menu inside Humo PM's navigation.
2. **Entitlements per product.**
   - `Subscription` and `Package` should carry `product`, so one organisation can subscribe to Humo PM and Humo Valuations separately.
   - Feature keys could be namespaced (`pm.governance`) when a second product arrives.
3. **Shared platform services as a separate layer.** Identity, step-up, audit, notifications and billing should become `Humo.Platform.*` services (and a shared Angular library), consumed by each product.
4. **Move the Humo staff console out of Humo PM** into a "Humo Console" app once a second product exists. Humo staff work across products.
5. ✅ **Done 11 Oct 2026: Humo Contractor is its own app** (`projects/humo-contractor`). The portal was removed from Humo PM; PM keeps `domain/contractor` to consume the network. See [20-humo-contractor-separation.md](20-humo-contractor-separation.md).
6. **Backend naming:** `Humo.PropertyManagement.{Api,Application,Domain,Infrastructure}`, `Humo.Platform.*`, and later `Humo.Valuations.*` and `Humo.Contractor.*`.
