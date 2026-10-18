# Backend readiness and prioritised roadmap

**Readiness in one line:** the frontend's *shape* is ready for a backend; its *rules, security model and test safety net* are not yet.

**Ready:**
- **Ports:** 40 abstract data sources, and components never touch mock code.
- **Command pattern:** every write goes through one gateway with permission, entitlement, step-up, version, validation and audit.
- **API conventions:** `docs/08`.

**Not ready:**
- **Scope** isn't modelled in the command path (F-02, F-08).
- **Key domain decisions** are open (trustees, levy model, ledger, statement immutability).
- **No tests** (C1, C2).
- **Business rules exist only in mock code** that will be thrown away (F-11).

## 1. Must be addressed before backend development starts

| # | Item | Why first | Effort | Owner |
|---|---|---|---|---|
| R1 | ~~Decide D1, D2, D5, D6~~ **Decided 10 Oct 2026** ([docs/17](../17-decisions.md)). D5 settled by **D14** (18 Oct 2026): ASP.NET Core Identity with passkeys on a Webway VPS ([docs/25](../25-identity-and-hosting-options.md)). | They define the authorisation model every endpoint enforces | Evaluation for D5 | Product + you |
| R2 | **Write the scope rule into the port contract:** reads derive scope from the session, and `schemeIds` is only a filter; commands check the target record's organisation and scheme. Document it in `docs/08`. | Prevents building endpoints that trust the client (F-02, F-08) | Small (docs + contract) | Architect |
| R3 | **Extract business rules from the mock stores into acceptance criteria**, per module: validation messages, lifecycle transitions, invariants and side effects (e.g. "posting a billing run locks it and updates balances"; "ending a trustee term ends trustee access"). | Mock stores are the spec (F-11). Without this, rules are silently lost | Medium (one module at a time; slice 1's modules first) | Dev + product |
| R4 | **Restore a test harness:** add a test target (the existing `tsconfig.spec.json` expects Vitest), a lint configuration, and a Prettier check. Then add **contract tests per port** that run against the in-memory adapter now and the HTTP adapter later. | No safety net today; contract tests make the mock → HTTP swap verifiable | Small–medium | Dev |
| R5 | **Environment-specific providers:** `provideMockData()` only in development; prototype controls excluded from production; an HTTP data layer behind the same ports. | Mocks and the persona switcher ship in production builds (F-05) | Small | Dev |

## 2. Fix during the first vertical slice (frontend issues touching slice-1 data)

| ID | Issue | Fix direction |
|---|---|---|
| F-03 | Seed identities used for portfolio-manager routing and names | Derive from live assignments (the server does the join) |
| F-26 | UTC date defaults (17 uses) | One "today in Africa/Johannesburg" helper; calendar dates as plain dates (`docs/08` §7) |
| F-22 | First-administrator invite allows any role | Restrict to Agency Administrator (D3) |
| F-28 | Trustee relationship through People bypasses board rules | Per D2: trustees only through the board; People links owners and tenants; derive trustee access from the board |
| F-14 | Quota versus levy | Follows the levy-model decision; at minimum validate consistency |
| F-25 | "Owner-occupied" with no owner | Derive occupancy from relationships |
| F-12 | False overdue compliance for onboarding schemes | Compliance starts from the scheme's "managed since" date; no Tasks while onboarding |
| F-07 / F-38 | Role-name checks (resolver) | Per D1 and D4: scope by assignment, plus the read-only browse-all permission; no role-name checks |

## 3. Can remain planned for later

- Humo Contractor (separate product).
- Configurable role profiles (D4).
- The push channel (SignalR).
- Catalogue editing.
- Executive analytics on generated data.
- Executive statement template; owner statement, invoice, receipt and work-order documents.
- Job "edit details".
- Person merge.
- Unit archive and renumber.
- Inbound email and SMS.
- Network messaging (F-16).
- Bundle size (F-17): becomes moot once the mock stores leave the production bundle (R5).

## 4. Recommended vertical-slice sequence

| Slice | Scope | Depends on | Exercises |
|---|---|---|---|
| **1. Tenant and portfolio foundation** | `GET /me` (identity, memberships, assignments, entitlements, flags); organisations; schemes; units; people; relationships; trust accounts; audit; Users & access (invite, assign, end, suspend). Swap `SessionDataSource`, `SchemeDataSource`, `UnitDataSource`, `PersonDataSource`, `AccessDataSource` and `AuditDataSource` to HTTP. | R1, R2, R4, R5 | Authentication, **scope enforcement**, entitlements, versions (409), validation (422), paging, audit, step-up for admin actions: every cross-cutting concern, on low-risk data |
| **2. Levy ledger, billing run and issued statement** | Ledger as the source of truth; billing run lifecycle; immutable issued statements; the PDF render service (one renderer) | 1; decisions on the levy model, D7, D8 | Money, irreversible commands, document rendering |
| **3. Receipts and credit control** | Bank import or capture, allocation, payer rules, suspense; collection pipeline and letters | 2 | Bank formats, reconciliation |
| **4. Work and approvals; maintenance, suppliers, payables** | Work items, approvals, delegation; jobs; quotes; invoices; payment batches (step-up release) | 1 (2 for payables) | Cross-aggregate workflows |
| **5. Governance and budgets** | Meetings, resolutions, actions; trustee boards (D2); rules and breaches; budgets approved by resolution | 1, 4 | Quorum, notice periods, document versions |
| **6. Communications and documents** | Delivery providers (email, SMS, WhatsApp), Sent, notices, inbox; library storage | 1 | External providers, POPIA consent |
| **7. Compliance, reports, platform operations** | Derived compliance; reports; Humo team, subscriptions, flags, health | All | Read-model performance |

**Why slice 1 first:**
- Every other module reads schemes, units, people and the session.
- It's the smallest slice that forces the security model (the audit's highest risk) to be built properly.
- It contains no money, so mistakes are cheap.
- It proves the port → HTTP swap pattern that every later slice reuses.

## 5. Risks of starting backend work too early

| Risk | Consequence |
|---|---|
| Building endpoints before R2 (scope) | Endpoints trust client-sent `schemeIds`: a cross-tenant data leak, by design |
| Porting mock stores as server code | The mocks generate history, store balances and use seed identities (F-03, F-04). Porting them bakes in the shortcuts |
| Starting finance before the levy, ledger and statement decisions | Rework of the core money model; issued documents that change after issue (F-44) |
| No contract tests | The mock → HTTP swap can't be verified; regressions found by clicking |
| Choosing the identity provider late | Step-up, impersonation and session design get retrofitted |
| Two sources of truth for trustees, carried into the database | Approvals and quorum inconsistent with the legal board register |
