# 21 · Internal roles, new customer accounts and approval

**Date:** 11 October 2026 (branch `feature/account-approval`).

**Status:** implemented in the frontend simulation, with unit tests. No backend, no email.

## 1. Names: no new role

The brief asks for "Humo Account Admin". That's the existing fixed role **Humo Account Manager** (`humo-account-manager`). The role catalogue is fixed in version 1 (D4), so nothing was renamed or added. A "trusted" Account Manager is **not a role**: it's an extra permission granted to one person, the same way impersonation is granted (`RoleAssignment.grants`).

| Role | Responsibility | New-account work |
|---|---|---|
| **Humo Account Manager** | Sales, onboarding and the customer relationship | Submits new customer accounts (`Platform.Customers.Manage`); follows their status; invites the first administrator once the account exists. With the individual grant, activates accounts without a separate approval. |
| **Humo Support** | Helping existing customers: troubleshooting, recovery, escalation | None. No `Platform.Customers.Manage`, so no new-account screen and no activation. |
| **Humo System Administrator** | Platform governance and oversight | Approves or rejects waiting accounts (`Platform.Customers.Approve`); grants and revokes delegated activation (`Platform.ManageHumoRoles`); sets the policy (`Platform.Config.Manage`); reviews it all in the audit log (`Platform.Audit`). |
| Humo Executive | Reporting | None. |

**Subscription changes:** the Account Manager role keeps `Platform.Subscriptions.Manage` (change packages and add-ons for their own customers, with step-up) **without approval**, and every change is audited with a required reason. This is **decision D11** (12 Oct 2026).

## 2. Permissions

| Permission | Held by | Notes |
|---|---|---|
| `Platform.Customers.Manage` (existing) | System Administrator, Account Manager | Submit a new account. |
| `Platform.Customers.Approve` (new) | System Administrator | Approve or reject a waiting account; never your own request. |
| `Platform.Customers.ActivateWithoutApproval` (new) | **Nobody by role.** Granted individually, on an Account Manager role only. | The brief's `Accounts.ActivateWithoutApproval`, renamed to the existing `Platform.Customers.*` convention. Only `Platform.ManageHumoRoles` (System Administrators) can grant or revoke it, with step-up and a reason. Nobody can change their own access. Support can't hold it. It grants nothing else. |
| `Platform.Config.Manage` (existing) | System Administrator | Change the account-creation policy (step-up, reason). |

Every check is made on a permission, in both the screens and the mock API (D4). The screens only hide what you can't do; the in-memory API refuses it.

## 3. The two workflows

**Mode A: approval required (the default).**
1. The Account Manager opens **New customer account**, from Platform › New accounts or Customers, and enters the registered name, the name people use, city, province, trial package, account manager and optional notes.
2. Validation:
   - required fields;
   - an active account manager;
   - **duplicates**: the same registered name or short name as an existing customer, or as another request still waiting.
3. A request `AR-…` is created, **waiting for approval**. No organisation exists yet.
4. System Administrators get an in-app notification.
5. A System Administrator other than the submitter opens it and chooses **Approve** or **Reject**:
   - **Approve:** re-checks duplicates and the account manager, then creates the organisation in **Onboarding** on a 30-day trial. The approver and the time are recorded.
   - **Reject:** needs a reason, which the submitter sees. No organisation is created.
6. The submitter is notified of the decision. The request page shows the result and the next step.

**Mode B: delegated activation.** The Account Manager holds `Platform.Customers.ActivateWithoutApproval`, and the policy allows delegation.
1. The same form and the same validation. The form says "Activate account" and explains what will happen.
2. **The API decides**, from the person's own grants and the policy in force. Nothing the client sends is trusted.
3. The organisation is created in **Onboarding** immediately. The request is recorded as *approved*, route *delegated*, decided by the submitter.
4. System Administrators get an in-app notification: "Activated with delegated authority".
5. The audit entry names the actor, the request and customer, the time, and the basis (`Platform.Customers.ActivateWithoutApproval`, plus the policy in force).
6. It appears under **Delegated activations** in the oversight view.
7. The confirmation says it was activated under delegated authority.

**Without the grant**, or with the policy at "approval for all", the same submission becomes Mode A. A revoked grant takes effect on the very next submission.

## 4. The account-creation policy

On Platform › New accounts. Only System Administrators can change it (`Platform.Config.Manage`, step-up, reason).

| Policy | Effect |
|---|---|
| **Approval required, except for Account Managers with delegated activation** (default) | Approval is the default for everyone. Only people individually granted the permission skip it. |
| **Approval required for every new account** | Delegated activation is paused for everyone. Grants stay, and work again when the policy switches back. |

**Rules:**
- Neither setting grants anything to anyone.
- A change applies to **new** submissions only. Waiting requests stay waiting, and nothing is activated or rejected by a policy change.
- Each change is audited and notifies the other System Administrators.

There's deliberately no "auto-approve everything" setting: it would give every Account Manager delegated authority without an individual grant.

## 5. Account lifecycle versus user access

- **Request:** `pending` → `approved` or `rejected`. Route: `approval` or `delegated`.
- **Organisation:** exists only after approval or delegated activation. It starts in the **existing** status `onboarding`, then follows the existing lifecycle (`active`, `suspended`, `archived`). No new organisation status was added.
- **Users:** activation creates **no identities, assignments or invitations**. The first administrator is invited as before, from Users & impersonation. That person accepts and sets up a passkey before anyone at the customer can sign in. **The organisation can't be moved to `active` until it has an Agency Administrator who has accepted** (22 October 2026), so an agency without users only exists while it's onboarding. Invitation acceptance, step-up and the first-administrator rule (D3, audit F-22) are untouched.

A pending or rejected request can't look like a customer, because no organisation exists for it.

## 6. Notifications and audit

**In-app notifications** use the topbar bell (new notification kind `platform`). The person who acted doesn't get their own notice.

| Event | Who is notified |
|---|---|
| Account waiting for approval | System Administrators |
| Activated with delegated authority | System Administrators |
| Approved or rejected | The submitter, and the other System Administrators |
| Delegated activation granted or revoked | The other System Administrators |
| Policy changed | The other System Administrators |

**Email:** in the prototype there's none, and nothing is shown as "sent". On the API (19 October 2026), each notice is also emailed to the same people, once the change is saved: subject = the notice title, body = the detail and a link to the request. Only active people get it (not invited, suspended or deactivated), never the person who acted. A failed email doesn't undo the change; it's logged, and the notice is still in the app (register R-9).

**Audit log** (Platform › Audit log, category *security*):
- submission;
- delegated activation, with its basis;
- approval;
- rejection, with the reason;
- grant and revocation of delegated activation;
- policy change;
- every refused attempt, such as Support trying to submit.

## 7. Screens

- **Platform › New accounts** (`/platform/account-requests`), for `Platform.Customers.Manage`:
  - the policy card;
  - tabs: *Waiting for approval*, *Delegated activations*, *Approved*, *Rejected*, *Mine*, *All*;
  - columns: account, status (with the customer's current lifecycle), how it was decided, requested by and when, decided by and when.
- **Request page** (`/platform/account-requests/:id`): the organisation details, the decision record and authority, and what happens next. *Approve* and *Reject* show only to someone who may decide, and not on their own request.
- **Customers:** the button is now *New customer account*, the same form.
- **Humo team › member** (Account Managers):
  - a **Delegated account activation** panel saying whether they have it and what it means, with a *Grant* or *Revoke* button for System Administrators. It confirms in a drawer (effect explained, reason required, step-up).
  - **What they can do**: their roles' permissions, with individual grants marked *Granted individually*.
  - a *Delegated activation* key fact.

## 8. Tests

`npm test` from `frontend/humo-web` (newly set up: the `@angular/build:unit-test` builder with Vitest 4 and jsdom). The tests are in `src/app/mock/data-sources/account-approval.spec.ts` and run the in-memory API through Angular's TestBed. All 13 pass:

1. A standard Account Manager submits an account for approval.
2. They can't activate without approval, or approve.
3. A granted Account Manager activates an eligible account (Onboarding).
4. System Administrators are notified of a delegated activation; the actor isn't.
5. A delegated activation is audited with its basis.
6. Support can't create or activate accounts.
7. Nobody grants themselves the permission; only Account Managers can hold it.
8. A System Administrator grants and revokes it, audited both ways.
9. A revoked grant, or the "approval for all" policy, isn't used for later accounts. This test also reads the policy back.
10. Approval and rejection are recorded; reasons are required; you can't decide your own request or decide twice.
11. Pending and rejected requests never create an organisation; duplicates are refused.
12. Activation creates no users or invitations.
13. Humo team impersonation, organisation edits and agency staff invites still work.

**Checking the tests themselves:**
- Breaking the policy check on purpose made test 9 fail.
- The browser check found a bug the first version of the tests missed: the policy read failed outside Angular's injection context. It's fixed, and test 9 now covers it.

## 9. Open points and conflicts

- ✅ **Resolved 12 Oct 2026: D4 said "12 fixed roles".** Removing the Contractor/Supplier role from Humo PM on 11 Oct 2026 (doc 20) left **11**. A correction note under D4 in doc 17 now records this; the decision itself is unchanged.
- ✅ **Resolved 12 Oct 2026: Account Manager and `Platform.Subscriptions.Manage`.** Kept, no approval, every change audited with a required reason (**D11**).
- **Seeded demo requests:** AR-1003 (Thabo, waiting) and AR-1002 (Dumisani, rejected). Nobody holds the delegated grant in the seed: the demo grants it live.

## 10. Simulated, and what the backend must do

- **Production-ready:** the frontend screens, the data shapes, the port (`AccountRequestDataSource`) and the rules as specified.
- **Simulated:**
  - the API (`InMemoryAccountRequestDataSource`);
  - persistence (browser storage);
  - notifications (in-app only, kept in this browser);
  - step-up (simulated passkey).
- **The backend must:**
  - enforce every rule in §2 to §5 server-side;
  - make submit and decide atomic (no double approval, no duplicate organisation);
  - store requests and decisions durably;
  - deliver notifications, including email (register R-9);
  - write the audit log append-only.

## 11. Demonstrating it

1. **Mode A.** Sign in as **Dumisani Ngcobo** (Humo Account Manager). Go to **Platform › New accounts**, choose **New customer account**, fill it in and choose **Submit for approval**. It shows *Waiting for approval*.
2. Sign in as **Terry Mosoma** (System Administrator). The bell shows "New account waiting for approval". Open it and choose **Approve**: the account is now *Approved*, the customer is *Onboarding*, and the next step is to invite the first administrator. (You could reject Thabo's AR-1003 with a reason instead.)
3. **Grant.** As Terry, go to **Humo team › Dumisani Ngcobo** and choose **Grant delegated activation**. Give a reason and confirm with the passkey.
4. **Mode B.** As Dumisani, choose **New customer account** again. The form now says **Activate account**. Submit: it's *Activated (delegated)* and onboarding at once.
5. As Terry: the bell shows "Activated with delegated authority". **New accounts › Delegated activations** lists it, and **Audit log** (search `AR-`) shows the basis.
6. **Revoke, or pause by policy.** As Terry, choose **Revoke** on Dumisani's page, or **Change policy** on New accounts. Dumisani's next account waits for approval again.
7. As **Lerato Dube** (Support): there's no *New accounts* entry, and the page refuses access.
