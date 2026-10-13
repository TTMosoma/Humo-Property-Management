# Demo walkthrough

**Before each demo:**
- *Prototype* › *Reset simulation…* › *Reset everything*, or use a private window.
- Sign in from *Demo accounts* on the sign-in page.

**Notes:**
- Step-up prompts (*Use passkey*) are simulated.
- The broader operational walkthroughs (levies, receipts, maintenance, governance) are in [../09-simulation.md](../09-simulation.md) and the docs for each area.

## Commercial management (about 10 minutes)

**1. The catalogue.** Sign in as **Terry Mosoma** (System Administrator) and open *Platform › Pricing & add-ons*.
- Package prices show *No price yet / Awaiting configuration*. Storage allowances (5 / 25 / 250 GB) and the WhatsApp and storage-pack prices are marked *Proposed, not approved*.
- *Edit* WhatsApp Communication: set a new price from a future date. Say: existing customers keep their agreed price; only new agreements from that date use it.

**2. A customer's agreement.** Sign in as **Mashoto Moropane** (Account Manager). Open *My accounts* › **Acacia Managing Agents** › *Billing & agreement*.
- **Recurring total:** R17 400 a month. Governance and Compliance are included in the agreed package price, and VAT shows *Not charged*.
- **Scheduled change:** *WhatsApp Communication at R100 a month* from **1 November 2026**, scheduled by Mashoto, with *+R100 a month from then*. It isn't in force yet: the customer gets WhatsApp on that date.
- **Agreement history:** each change shows who made it, why, when it takes effect, and the approval basis (D11).

**3. Storage.** Acacia is at **85%** of its 25 GB: *Over 80%*.
1. *Add storage*: the drawer preselects the 10 GB pack.
2. Type a reason. The preview shows **R17 400 → R17 550 (+R150 a month)**, first invoiced on the next billing date, and the proration policy (*awaiting business approval*).
3. *Confirm change*, then verify with the passkey. Storage drops to ~61%, and the history records Mashoto.

**4. A full allowance and manual EFT.** Open **Fynbos Property Admin** › *Billing & agreement*.
- **Storage:** *Full: uploads refused*. Nothing is charged or upgraded automatically.
- **October invoice:** *Overdue*, with a payment *Awaiting verification*: the customer sent proof, but it isn't on Humo's bank statement yet.
- As Mashoto there's no *Verify* button: account managers can't mark payments verified.

**5. Verifying a payment.** Sign in as **Terry Mosoma**, open Fynbos › *Billing & agreement*.
1. Choose *Verify against bank statement* and enter the statement line reference.
2. Verify with the passkey. The invoice becomes *Paid (simulated)*, verified by Terry.

**6. A card payment, simulated.** Still as Terry, on Acacia:
1. *Issue next invoice (simulated)*.
2. *Start checkout (simulated)*. The payment shows *Checkout started*, and the invoice stays unpaid.
3. *Simulate provider confirmation*. The invoice is *Paid (simulated)*. Say: in production only the provider's verified notification does this, never a button.

**6b. An annual renewal fee.** Still as Terry, open **Umgeni BC Services** › *Billing & agreement*.
1. *Annual renewal* shows 15 Nov 2026 with a R3 000 renewal fee, invoiced once and not in the monthly total.
2. *Issue next invoice (simulated)*: the November invoice carries the package, the renewal fee and the R500 service credit.
3. The renewal moves to 15 Nov 2027.

**7. The customer's view.** Sign in as **Thandeka** (Acacia, Agency Administrator) › *Settings › Plan & features*.
- She sees her storage, her billing preference, the next invoice date and Mashoto as her account manager.
- She doesn't see Humo's prices for other customers, or health data.
- Near the limit, she can *Ask Humo for more storage*.

**8. Who can see what.**
- **Lerato (Support):** no *Billing & agreement* tab.
- **Nomsa (switch to Humo Executive):** can see it, but not change it.
