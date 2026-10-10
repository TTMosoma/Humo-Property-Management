# 19 · Demo deployment

**Purpose:** put the Humo Property Management prototype on a public address for client demos. The aim is quick and usable, not production hosting.

**Date:** 10 October 2026 (branch `demo-ready`).

## Address

**Recommended:** `pm-demo.humo.co.za`

**Why:**
- It says which product it is, and that it's a demo.
- It leaves the obvious production names free:
  - `pm.humo.co.za` for Humo Property Management;
  - `contractor.humo.co.za` for Humo Contractor;
  - `humo.co.za` for the company site.
- The company domain stays separate from any one product, as in [07-brand-architecture.md](07-brand-architecture.md).

**Alternative:** `demo.humo.co.za`, if only one product will ever be demoed. That's unlikely once Humo Contractor has its own demo.

## What the demo is

The build is a **static site**: HTML, JavaScript and CSS only. There's no server and no database.

- **Data per visitor.** Each visitor's data lives in their own browser (localStorage).
  - Two clients looking at the same time never see each other's changes.
  - A client's changes stay in their browser until they reset them.
- **Reset.** *Prototype* (bottom right) › *Reset simulation…* › *Reset everything* returns to the seeded demo data. Do this before each demo.
- **Sign-in.** Visitors start at the Humo sign-in page (`/sign-in`).
  - Enter a demo person's email, or open *Demo accounts* under the form and choose one. The passkey is simulated.
  - *Email me a sign-in link* works too: the *Prototype* box on the "Check your email" step opens the link.
  - Details are in register R-8.
- **Personas.** The prototype controls stay in the demo build, so the presenter can switch personas and roles.
- **Search engines.** The site asks search engines not to index it (`robots.txt` and an `X-Robots-Tag` header).
- **What's simulated.** Every simulated action is listed in [18-production-readiness-register.md](18-production-readiness-register.md).

## Build

From `frontend/humo-web`:

```bash
npm ci
npm run build:demo
```

**Output:** `frontend/humo-web/dist/humo-web/browser/`. Upload the **contents** of that folder.

`build:demo` is the production build plus the files in `deploy/demo/`:

| File | For | Does |
|---|---|---|
| `.htaccess` | Apache hosts (cPanel: most South African shared hosting) | Single-page-app rewrites, so deep links and refreshes work. `noindex`. `index.html` is never cached, so a new upload shows at once. |
| `_redirects`, `_headers` | Netlify or Cloudflare Pages | The same, in their format. |
| `robots.txt` | Everyone | Blocks all crawlers. |

## Hosting: pick one

| Option | Effort | Notes |
|---|---|---|
| **A. Cloudflare Pages (recommended)** | About 15 minutes | Free. HTTPS is automatic. Create a Pages project, upload `dist/humo-web/browser` (or connect the GitHub repo: build command `cd frontend/humo-web && npm ci && npm run build:demo`, output directory `frontend/humo-web/dist/humo-web/browser`). Add the custom domain `pm-demo.humo.co.za`. Optionally, put **Cloudflare Access** in front, so only invited emails can open it. |
| B. The existing humo.co.za hosting (cPanel) | About 15 minutes | Create the subdomain `pm-demo` in cPanel, upload the folder contents to its document root (include `.htaccess`, which is a hidden file), and turn on AutoSSL / Let's Encrypt. |
| C. Netlify | About 15 minutes | Drag and drop the folder in the Netlify dashboard; add the custom domain. |

## DNS

At whoever hosts DNS for `humo.co.za`:

| Host | Option A | Option B | Option C |
|---|---|---|---|
| `pm-demo` | `CNAME` → `<project>.pages.dev` (Cloudflare shows the target) | Created by cPanel (an `A` record to the hosting server) | `CNAME` → `<site>.netlify.app` |

DNS changes usually take minutes, occasionally a few hours.

## Updating the demo

1. Merge the change to `main`.
2. Run `npm run build:demo`.
3. Upload again, or let Cloudflare or Netlify rebuild from GitHub.
4. Visitors get the new version on their next page load, because `index.html` isn't cached.

**Saved data after an update:**
- Saved demo data is kept across updates.
- If a change to the data model makes old saved data incompatible, the developer bumps `SCHEMA` in `mock/simulation/simulation-storage.ts`, and every visitor starts again from the seed data.
- If a demo looks wrong after an update, reset it from *Prototype*.

## Before each demo

- [ ] Open `https://pm-demo.humo.co.za` in a private window, or reset the simulation.
- [ ] Sign in from *Demo accounts* on the sign-in page as the persona you start with. The suggested order:
  1. Executive overview.
  2. Portfolio Manager's day: Inbox, then jobs, then approvals.
  3. Finance: billing run, receipts, credit control.
  4. Governance: AGM, trustees, rules.
  5. A trustee's and an owner's view.
- [ ] Close the *Prototype* panel before sharing your screen.

## Not for production

This configuration is for the demo only (register **R-6**, **R-7**). Production needs:
- the environment split (P1-2);
- a backend;
- its own hosting settings.
