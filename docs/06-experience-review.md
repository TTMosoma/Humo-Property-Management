# 06 — One product, many experiences: integration review

This pass ties the identity, role, security, SaaS, Executive, Account Manager and Contractor work into one product. It reuses one shell, one design system and one set of patterns. There are no new applications.

## 1. Experiences by role

| Role | Lands on | The experience answers |
|---|---|---|
| Agency Administrator | Dashboard | What needs attention across the agency; people, access, plan and audit in Settings |
| Portfolio Manager | Dashboard | My schemes: approvals, arrears, maintenance end to end, schemes that need me |
| Finance User | Dashboard | The money cycle: payments to allocate, arrears, supplier invoices, approvals |
| Operations / Maintenance | Dashboard | Jobs: triage, quotes, work in progress, suppliers |
| Trustee | Dashboard | My scheme: decisions waiting, collection, arrears, jobs, next meeting |
| Owner / Tenant | Home | What I owe, my requests ("was it fixed?"), notices |
| Contractor | Humo Contractor | Quote requests to answer, jobs, reputation, compliance |
| Humo Executive | Overview | The business: MRR, ARR, growth, retention, health, expansion |
| Humo Account Manager | My accounts | Customer success: needs you, health, subscriptions, opportunities, support |
| Humo Support | Customers | Customer context, users, tickets, audit |
| Humo System Administrator | Customers | The platform: customers, packages, users, impersonation, audit, flags |

## 2. Shared patterns

- **Context card** (top of navigation): **Working as {Role} · {Organisation} · {Scope}**. It is also a second way to switch role. The top-bar control shows identity and role. A role switch is acknowledged with a calm strip, never a warning colour.
- **Workflow strips** turn connected work into visible lines with counts at each step:
  - Maintenance: Reported → Quotes → Approval → Work → Completion → Invoice
  - Finance: Billing → Payments → Allocation → Statements → Credit control
  - Quote request: Request → Contractors → Quotes → Approval → Scheduled → Started → Completed → Invoice
- **Actionable tiles only.** Every dashboard number links to where the work is done. There are no vanity metrics.

## 3. Colour language

| Meaning | Colour | Where |
|---|---|---|
| Normal | Brand navy and leaf | Everything |
| Role | One brand accent for all roles | Role icon in the top bar, context card, switcher (no rainbow) |
| Security attention | **Amber** | Step-up dialog (top border, seal) |
| Critical security | **Red** | Impersonation only: banner, frame, top-bar chip, audit rows |
| Success / warning / danger | Existing semantic colours | Status |

Products differ by layout, not by palette:
- **Humo Contractor:** top bar and bottom tabs.
- **Executive:** a dark command-centre canvas.

## 4. States checklist

| State | Treatment |
|---|---|
| Loading / empty / error | `loadable()` (state from the real request), skeletons, typed empty states and error-with-retry on every data page |
| Permission denied | "You don't have access", plus "Switch role to …" when another of your roles can open it |
| **Feature unavailable** | A locked navigation entry (not hidden). The page says "{Feature} — not included in your current plan" with what it does. Administrators get **Request upgrade**; others are told to ask their administrator. |
| No scope assigned | Dashboard: "No schemes assigned to you yet" |
| No active context | The context card always states role, organisation and scope (or "No schemes assigned") |
| Step-up required | Amber verification dialog; the mock API refuses stale proofs |
| Impersonation | Red banner (Viewing as / Role / Organisation / Mode / Exit) and red frame, in both the PM and Contractor shells. Observe mode removes actions, and the API refuses writes. |
| Successful action | Toasts that say what happened and what happens next |

## 5. Final review: the eleven questions

1. **Who am I?** The top bar shows name and role; the context card shows "Working as". During impersonation both say "Impersonating", with a red banner.
2. **Which role is active?** The role label is always visible, including on phones, and the switch is acknowledged.
3. **What is my scope?** The context card shows scope; the top-bar chip focuses one scheme; the dashboard header repeats it.
4. **What can I do?** Navigation follows role. Actions are shown only when permitted. Plan-locked features explain themselves.
5. **Am I impersonating?** It is impossible to miss: red banner, frame and chip, on every page of every shell.
6. **Is extra verification needed?** Buttons say "Verify and …", and the amber dialog explains why.
7. **Does the customer understand their subscription?** Settings › Plan & features shows the package, each feature's source, and "Ask Humo". Locked entries point there.
8. **Can an Account Manager understand customer health?** Yes: a health score with each signal explained, adoption by module, opportunities with reasons, tickets, requests and renewals.
9. **Can an Executive understand the Humo business?** Yes: an overview plus focused Revenue, Growth, Account health and Opportunities views.
10. **Can a contractor understand their jobs and quotes?** Yes: waiting for your quote, quotes sent (and whether they were viewed or accepted), work orders, reputation and compliance.
11. **Marketplace-ready without being one?** Yes: business parties, reputation, verification, a discovery query and lifecycle events exist. Directory, search, bidding and fees are deliberately absent.

**One product?** Yes. One shell, sidebar and context card serve PM and Humo staff; the same security language, states and components appear everywhere. Humo Contractor shares the identity, impersonation treatment and components, with a job-first layout.

## 6. Remaining recommendations

1. **Finance navigation for the Finance User.** Rename and reorder to Payments / Debtors / Creditors once Billing and Credit control are built, rather than renaming placeholder pages now.
2. **Governance for the demo.** Governance is locked for Acacia. Before Slice C, add the Governance add-on to Acacia (one click as Dumisani), or move the demo agency to Enterprise.
3. **Locked deep links keep the previous URL.** This is because of `skipLocationChange`, which is intended for typed URLs. Consider updating the URL for clicks from navigation.
4. **Dashboard figures.** Billing and statement steps show schedule notes, not counts, until the billing run exists.
5. **Contractor work orders.** The integration feed is a mock join; the backend needs real job events.
6. **Accessibility pass.** Contrast of the red banner in dark mode, and focus order in the impersonation dialog. Run a full WCAG 2.1 AA audit before pilot.
7. **Screenshots.** Most visual checks were done at phone width; the desktop layouts were checked by reading the page.
