# 10 — Governance: run the trustee meeting (Slice C, Checkpoint 5)

Status: **implemented in the frontend simulation** (October 2026).

**The flow:** Meeting → Resolution → Action (a Task) → Completion. Meetings, resolutions and actions follow review finding F21 (`docs/02-ux-review.md` §1.11). The notice and minutes are template-driven A4 documents (`docs/document-template-architecture.md`).

## 1. The model

| Concept | What it is | Where |
|---|---|---|
| **Meeting** | A trustee meeting, AGM or SGM of one scheme, with agenda, attendees, pack, notice, attendance and minutes | `Meeting` in `domain/models/meeting.ts` |
| **Lifecycle** | Draft agenda → Notice sent → Pack ready → Held → Minutes draft → Minutes approved (or Cancelled) | `MEETING_STAGES` |
| **Resolution** | A decision, numbered per scheme (`RES-KC-17`): wording, outcome and votes. Passed at a meeting or **in writing** (round-robin) | `Resolution` |
| **Action** | Something a resolution requires someone to do. **It is a Task** (`meeting-action` work item); its status is the Task's status | `ResolutionAction.workItemId` |
| **Progress** | Awaiting trustees → Passed / Not passed → Actions open → Completed (the last action done) | `resolutionProgress()` |
| **Register** | A view over resolutions, never a second place to type them | Governance › Resolutions & actions |

**Rules the API enforces.** In the simulation they live in `GovernanceStore.check()` and run through `MockGateway`, alongside the permission, the `governance` entitlement, the version (409) and the audit.

| Rule | Prototype value |
|---|---|
| **Notice period** | Trustee meetings 7 days, AGM/SGM 14 days (`NOTICE_DAYS`); sending notice later than that is refused with the earliest valid date. The scheme's rules set the real values. |
| **What each stage allows** | The agenda can only change while in draft; attendance is recorded after notice; resolutions and minutes after the meeting is held. |
| **Quorum** | Trustee meetings need a majority of trustees; general meetings need owners holding a third of the votes, in person or by proxy (one vote per unit). An inquorate meeting is refused: it can't take decisions. |
| **Votes** | Votes can't exceed the voters present, and "passed" needs more votes for than against. |
| **Cancelling** | Needs a reason. Only possible before the meeting is held. |

## 2. How the pieces connect

- **Actions are Tasks.** Recording a passed resolution creates one Task per action, assigned to:
  - agency staff covering the scheme; or
  - a trustee with a Humo sign-in.

  Completing the Task in *My work › Tasks* marks the action done on the meeting, and the last one completes the resolution. Both are logged on the meeting's activity.
- **Minutes approval goes through the Approval engine.** *Send minutes for approval* creates a `minutes-approval` item:
  - **Approved:** minutes are final and the meeting is *Minutes approved*.
  - **Sent back:** the minutes stay in draft, with the comment logged.
- **Written resolutions go through the Approval engine too.** *Propose written resolution* creates a `resolution-approval` item for the scheme's trustees.
  - **Approved:** it passes, and its planned actions become Tasks.
  - **Rejected:** it's recorded as not passed.
- **Compliance.** Sending notice of an AGM resolves the scheme's "Set AGM date and send notice" compliance task.
- **Scheme workspace:**
  - "Next meeting" comes from Governance for schemes that have meetings.
  - The scheme's *Meetings* tab is the meetings list for that scheme.
- **Entitlement.** Everything is behind the `governance` feature. Acacia now has the Governance add-on in the seed data, as `docs/06-experience-review.md` recommended.

## 3. Documents

| Document | When it's issued | Template |
|---|---|---|
| **Notice of meeting**: addressee, date, time, venue, notice given, the numbered agenda, the notice-period statement, proxies and quorum for general meetings, signed for the trustees | When notice is sent. The template and version are recorded on the meeting. | `meeting-notice.standard` (Standard), `meeting-notice.professional` (Premium, agency branding) |
| **Minutes**: present, apologies, in attendance, quorum, the minute of each agenda item with its resolutions (wording, votes), an actions table, and the approval line | When the trustees approve them. Until then they show a **Draft** banner. | `meeting-minutes.standard`, `meeting-minutes.professional` |

- **Before a document is issued** it renders with the organisation's current default for its type.
- **After it's issued** it renders with the recorded version, like statements.
- **Shared A4 sheet.** All three layouts (statement, notice, minutes) share `features/documents/document-sheet.scss`: page, sheet, letterhead, addressee block, table, footer and branded extras. The levy statement renders byte-for-byte the same size as before the extraction.

## 4. Screens

| Screen | Who | What |
|---|---|---|
| **Governance › Meetings** (also each scheme's *Meetings* tab) | Staff, trustees (`Governance.View`) | Upcoming · Minutes to finish · Held · All. *Schedule meeting* (`Meetings.Manage`), also from the "+ New" menu. |
| **Meeting page** (record page + stage tracker) | Same; actions need `Meetings.Manage` | The next step for each stage. Agenda (edit in draft; minute and resolution per item once held), resolutions with their actions' status, trustees and attendance, documents, activity. |
| **Notice / Minutes** | Same | The A4 document, *Print or save PDF*, and which template version it uses. |
| **Governance › Resolutions & actions** | Same | Outstanding · Awaiting trustees · All, with progress ("2 of 3 actions done · overdue"). *Propose written resolution*. |
| **My work › Approvals** | Trustees; minutes also agency administrators | Minutes approval and written resolutions beside quotes and invoices. Items without an amount show a plain *Approve*. |
| **My work › Tasks** | Whoever an action is assigned to | Meeting actions, with a link back to the meeting. |

## 5. Seed data (Kingfisher Court, The Willows)

- **Kingfisher Court, last month's trustee meeting.** Minutes approved by Sipho Khumalo. Three resolutions:
  - **RES-KC-13:** completed.
  - **RES-KC-14:** CCTV quotes, assigned to Johan.
  - **RES-KC-15:** the pet rule, assigned to Sipho and overdue.
- **Kingfisher Court, next month's trustee meeting.** Draft agenda; the walkthrough starts here.
- **RES-KC-16.** A written resolution (gate motor contract) waiting for the Kingfisher Court trustees.
- **The Willows.** Held; minutes waiting for approval (RES-TW-6, RES-TW-7 with an attorney action).

The seed's actions replace the old fixture tasks w28–w30 (same ids), so Tasks and the meetings agree.

**Reset needed for older simulated data.** Browsers with simulated data from before this change need **Reset simulation** (prototype toolbar) to pick up the Governance add-on and the seeded meetings.

## 6. Walkthrough

1. **As Johan (Portfolio Manager)**, open Governance › Meetings → *Trustee meeting — (next month)*:
   - **Send notice.** Move the date inside 7 days first to see the notice-period refusal.
   - **Mark pack ready.**
   - **Record the meeting.** Mark two trustees as apologies to see the quorum refusal.
   - **Record a resolution** on the CCTV item, with an action. It appears on Tasks.
   - **Minute an item**, then **Send minutes for approval**.
2. **Still as Johan**, in *Tasks*, mark "Obtain 3 quotes for CCTV upgrade" done. Last month's meeting shows RES-KC-14 completed.
3. **As Sipho (Trustee)**, in *Approvals*:
   - Approve the October minutes: the meeting moves to *Minutes approved* and the minutes lose their Draft banner.
   - Approve RES-KC-16: its action appears on Johan's Tasks.
4. **Open the notice and minutes**, then *Print or save PDF*.

## 7. Not yet

| Gap | Note |
|---|---|
| Real round-robin voting | A written resolution passes on one trustee's approval in the simulation. The real rule (a majority of trustees signing) needs per-trustee votes on the approval. |
| Proxies and owner attendance at general meetings | Captured as a count, not per owner; no proxy forms or voting by unit quota. |
| Sending notice | Simulated: no email is sent, and the notice isn't published to the owner portal yet (Communications, Checkpoint 6/8). |
| Meeting pack from the document library | Listed by name; the library comes with Checkpoint 7. |
| Trustee boards, elections at AGMs, scheme rules | Still planned pages (Governance › Trustee boards, Rules). |
| AGM checklist links | Budget approval from Budgets, insurance values from the valuer: planned. |
| Editing or rescinding a resolution after the minutes are approved | A rescinding resolution at a later meeting is the proper route; not built. |
