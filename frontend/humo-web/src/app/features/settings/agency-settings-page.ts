import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { EMAIL_SIGNATURE_LINES, LARGE_APPROVAL_AMOUNT, OrganisationDataSource, SchemeAuthority, SchemeTrustAccount, SettingsDataSource, TRUSTEE_PERMISSION_MONTHS, TrusteePermission } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { formatRand } from '../../ui/format/money';
import { REASON_FIELD, openForm } from '../shared/form-drawer';
import { agencyDetailsForm, trustAccountForm } from './settings-forms';

/** Settings › Agency: the agency's registered details and each scheme's trust account. */
@Component({
  selector: 'app-agency-settings-page',
  imports: [PageHeader, DataTable, CellDef, StatusPill, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Settings" title="Agency" subtitle="Your registered details and the trust accounts owners pay into. Branding and what prints on documents are in Documents & templates." />

    @if (session.organisation(); as org) {
      <section class="surface panel">
        <div class="panel-head">
          <h2 class="section-title">Approvals</h2>
          @if (canManage()) {
            <button type="button" class="btn btn-secondary btn-sm" (click)="editApprovalAmount()">Change</button>
          }
        </div>
        <p class="muted">Approving {{ rand(org.approvalStepUpAmount ?? defaultAmount) }} or more (a quote, an invoice or a payment) needs a fresh passkey or Humo Mobile approval. Rejecting never does.</p>
      </section>
    }

    @if (agency.loading()) {
      <ui-skeleton variant="tiles" [count]="2" />
    } @else if (agency.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the agency’s settings" (retry)="agency.retry()" /></div>
    } @else {
      @let a = agency.value()!;
      <section class="surface panel">
        <div class="panel-head">
          <h2 class="section-title">Details</h2>
          @if (canManage()) {
            <button type="button" class="btn btn-secondary btn-sm" (click)="editDetails()">Edit</button>
          }
        </div>
        <dl class="facts">
          <dt>Registered name</dt><dd>{{ a.details.name }}</dd>
          <dt>Trading name</dt><dd>{{ a.details.shortName }}</dd>
          <dt>Company registration</dt><dd>{{ a.details.registrationNumber || '—' }}</dd>
          <dt>VAT number</dt><dd>{{ a.details.vatNumber || '—' }}</dd>
          <dt>Fidelity Fund certificate</dt><dd>{{ a.details.ffcNumber || '—' }}</dd>
          <dt>Address</dt><dd>{{ a.details.address }}@if (a.details.address) {, }{{ a.details.city }}, {{ a.details.province }}</dd>
          <dt>Contact</dt><dd>{{ a.details.email || '—' }} · {{ a.details.phone || '—' }}</dd>
        </dl>
        <p class="muted">Logo, colours and the contact line printed on statements: <a routerLink="/settings/documents">Documents & templates</a>.</p>
      </section>

      <section class="surface panel">
        <div class="panel-head">
          <h2 class="section-title">Email signature</h2>
          @if (canManage()) {
            <button type="button" class="btn btn-secondary btn-sm" (click)="editSignature()">{{ a.emailSignature ? 'Edit' : 'Add' }}</button>
          }
        </div>
        <p class="muted">Under every email to owners and tenants: messages, notices, statements, letters and invoices, below your wordmark from Documents & templates. Staff add their own sign-off in their profile.</p>
        @if (a.emailSignature) {
          <pre class="signature">{{ a.emailSignature }}</pre>
        } @else {
          <p class="muted">No signature yet.</p>
        }
      </section>

      <section class="surface panel">
        <h2 class="section-title">Trust accounts</h2>
        <p class="muted">Each scheme’s levies are paid into its own trust account. Statements and collection letters show these details. Changing one needs a fresh passkey or Humo Mobile approval and stays unverified until the bank’s letter is on file.</p>
        <p class="muted">
          Online payments: link a scheme’s own Payfast account and owners can pay by card or Instant EFT from the owner portal. Payfast pays out to the trust account; Payfast’s fee is the
          scheme’s bank charge, and the owner is credited in full.
        </p>
        @if (accounts.loading()) {
          <ui-skeleton [count]="5" />
        } @else {
          <ui-data-table caption="Trust accounts" [rows]="accounts.value() ?? []" [columns]="columns" [rowId]="rowId">
            <ng-template uiCell="scheme" let-t>{{ t.scheme.name }}</ng-template>
            <ng-template uiCell="bank" let-t>
              <div>{{ t.account.bank }} · {{ t.account.branchCode }}</div>
              <div class="muted">{{ t.account.accountName }}</div>
            </ng-template>
            <ng-template uiCell="number" let-t><span class="num">{{ t.account.accountNumber }}</span></ng-template>
            <ng-template uiCell="verified" let-t><ui-status-pill [label]="t.verified ? 'Verified' : 'Awaiting bank letter'" [tone]="t.verified ? 'success' : 'warning'" /></ng-template>
            <ng-template uiCell="online" let-t>
              @if (t.payfast; as p) {
                <div>Payfast {{ p.merchantId }}</div>
                @if (p.linkedBy) {
                  <div class="muted">Linked by {{ p.linkedBy }}</div>
                }
              } @else {
                <span class="muted">Off</span>
              }
            </ng-template>
            <ng-template uiCell="action" let-t>
              @if (canManage()) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="change(t)"><ion-icon name="finger-print-outline" aria-hidden="true" /> Change</button>
                @if (t.payfast) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="unlinkPayfast(t)">Turn off online payments</button>
                } @else if (t.account.accountNumber) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="linkPayfast(t)"><ion-icon name="card-outline" aria-hidden="true" /> Set up Payfast</button>
                }
              }
            </ng-template>
          </ui-data-table>
        }
      </section>

      @if (canManage()) {
        <section class="surface panel">
          <h2 class="section-title">Approving with one authoriser</h2>
          <p class="muted">
            When you’re the agency’s only approver, a scheme’s trustees on Humo approve what you prepared. On a scheme with no trustee on Humo, you can approve alone under the
            trustees’ written permission: once per scheme, for up to {{ months }} months, with your passkey each time. An approval made alone takes effect after 24 hours, the
            trustees on record are told, and it’s flagged in the audit log. Once a second authoriser joins, approving alone stops applying.
          </p>
          @if (authority.loading()) {
            <ui-skeleton [count]="3" />
          } @else {
            <ui-data-table caption="Approving with one authoriser" [rows]="authority.value() ?? []" [columns]="authorityColumns" [rowId]="authorityId">
              <ng-template uiCell="scheme" let-a>{{ a.schemeName }}</ng-template>
              <ng-template uiCell="trustees" let-a>
                @if (a.trusteesOnHumo) {
                  {{ a.trusteesOnHumo }} trustee{{ a.trusteesOnHumo === 1 ? '' : 's' }} on Humo
                } @else {
                  <span class="muted">None on Humo</span>
                }
              </ng-template>
              <ng-template uiCell="permission" let-a>
                @if (a.permission; as p) {
                  <div>{{ p.summary }}</div>
                  <div class="muted">Until {{ p.until }} · added by {{ p.addedBy }}</div>
                } @else if (!a.trusteesOnHumo) {
                  <ui-status-pill label="No permission" tone="warning" />
                }
              </ng-template>
              <ng-template uiCell="action" let-a>
                @if (!a.trusteesOnHumo) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="addPermission(a)">
                    <ion-icon name="finger-print-outline" aria-hidden="true" /> {{ a.permission ? 'Renew' : 'Add' }}
                  </button>
                }
                @if (a.permission; as p) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="withdrawPermission(p)">Withdraw</button>
                }
              </ng-template>
            </ui-data-table>
          }
        </section>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .signature { margin: var(--s-3) 0 0; padding: var(--s-3) var(--s-4); font: inherit; font-size: var(--fs-sm); white-space: pre-wrap; background: var(--c-surface-2); border-radius: var(--r); }
    .facts { display: grid; grid-template-columns: 200px 1fr; gap: var(--s-2) var(--s-4); margin: var(--s-2) 0 var(--s-3); font-size: var(--fs-sm); }
    .facts dt { color: var(--c-text-muted); }
    .facts dd { margin: 0; }
    .muted { margin: 0 0 var(--s-3); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .num { font-variant-numeric: tabular-nums; }
    @media (max-width: 600px) { .facts { grid-template-columns: 1fr; } .facts dd { margin-bottom: var(--s-2); } }
  `,
})
export class AgencySettingsPage {
  private readonly data = inject(SettingsDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);
  private readonly organisations = inject(OrganisationDataSource);
  protected readonly defaultAmount = LARGE_APPROVAL_AMOUNT;
  protected readonly rand = (n: number) => formatRand(n, { cents: false });

  protected readonly agency = loadable(() => this.data.agency());
  protected readonly accounts = loadable(() => this.data.trustAccounts(this.scope.accessible().map((s) => s.id)));
  protected readonly canManage = computed(() => this.session.can('Organisation.Manage') && !this.session.readOnly());

  protected readonly columns: ColumnDef<SchemeTrustAccount>[] = [
    { key: 'scheme', header: 'Scheme', mobile: 'title', width: '20%', sort: (t) => t.scheme.name },
    { key: 'bank', header: 'Bank', width: '24%' },
    { key: 'number', header: 'Account number', width: '140px' },
    { key: 'verified', header: 'Status', width: '150px', sort: (t) => (t.verified ? 1 : 0) },
    { key: 'online', header: 'Online payments', width: '140px' },
    { key: 'action', header: '', align: 'end', width: '170px' },
  ];
  protected readonly rowId = (t: SchemeTrustAccount) => t.scheme.id;

  protected editDetails(): void {
    agencyDetailsForm(this.drawer, this.data, this.agency.value()!);
  }

  /** The agency's own threshold (doc 03). Lowering it asks for a passkey more often; it can't be switched off. */
  protected editApprovalAmount(): void {
    const org = this.session.organisation()!;
    openForm(this.drawer, {
      eyebrow: 'Agency · Approvals',
      title: 'Passkey approval threshold',
      intro: 'Approving this amount or more needs a fresh passkey or Humo Mobile approval. Between R1 000 and R10 000 000.',
      fields: [
        { key: 'amount', label: 'Amount (rand)', type: 'number', required: true },
        REASON_FIELD,
      ],
      initial: { amount: String(org.approvalStepUpAmount ?? LARGE_APPROVAL_AMOUNT) },
      submitLabel: 'Save',
      stepUp: { action: 'change-platform-config', detail: 'Change the passkey approval threshold' },
      submit: (f) => this.organisations.setApprovalStepUpAmount(org.id, Number(f['amount']), f['reason'], org.version),
      success: (_r, f) => `Approvals of ${this.rand(Number(f['amount']))} or more now need a passkey.`,
      failure: 'The threshold wasn’t changed',
    });
  }

  protected readonly months = TRUSTEE_PERMISSION_MONTHS;
  protected readonly authority = loadable(() => this.data.trusteePermissions());
  protected readonly authorityColumns: ColumnDef<SchemeAuthority>[] = [
    { key: 'scheme', header: 'Scheme', mobile: 'title', sort: (a) => a.schemeName },
    { key: 'trustees', header: 'Trustees', width: '170px' },
    { key: 'permission', header: 'Trustees’ permission' },
    { key: 'action', header: '', align: 'end', width: '200px' },
  ];
  protected readonly authorityId = (a: SchemeAuthority) => a.schemeId;

  /** D24: the trustees' signed permission (PDF), with a passkey. */
  protected addPermission(a: SchemeAuthority): void {
    openForm(this.drawer, {
      eyebrow: `${a.schemeName} · Approving alone`,
      title: a.permission ? 'Renew the trustees’ permission' : 'Add the trustees’ permission',
      intro: `The trustees’ written permission for the agency to approve on ${a.schemeName}’s behalf while it has no trustee on Humo: a signed resolution, letter or email. It lasts up to ${TRUSTEE_PERMISSION_MONTHS} months from the day they signed it.`,
      fields: [
        { key: 'file', label: 'Signed permission (PDF)', type: 'file', required: true, accept: '.pdf' },
        { key: 'summary', label: 'What it is and who signed it', type: 'text', required: true, placeholder: 'Resolution of 1 October 2026, signed by S Khumalo and L Mokoena' },
        { key: 'grantedOn', label: 'Signed on', type: 'date', required: true, half: true },
        { key: 'until', label: 'Valid until (optional)', type: 'date', half: true, help: `Leave empty for ${TRUSTEE_PERMISSION_MONTHS} months.` },
      ],
      submitLabel: 'Verify and save',
      stepUp: { action: 'change-security', detail: `Let the agency approve alone on ${a.schemeName}` },
      submit: (f, files) => this.data.addTrusteePermission({ schemeId: a.schemeId, summary: f['summary'], grantedOn: f['grantedOn'], until: f['until'] || undefined }, files['file']),
      success: () => `Saved. On ${a.schemeName}, you can now approve alone; each approval takes effect after 24 hours.`,
      failure: 'The permission wasn’t saved',
    });
  }

  protected withdrawPermission(p: TrusteePermission): void {
    openForm(this.drawer, {
      eyebrow: 'Approving alone',
      title: 'Withdraw the trustees’ permission',
      intro: `${p.summary}. Approvals already in their cooling-off still take effect unless you stop them in My work.`,
      fields: [REASON_FIELD],
      submitLabel: 'Withdraw',
      submit: (f) => this.data.withdrawTrusteePermission(p.id, f['reason']),
      success: () => 'Withdrawn. Approving alone no longer applies on this scheme.',
      failure: 'The permission wasn’t withdrawn',
    });
  }

  protected editSignature(): void {
    const a = this.agency.value()!;
    openForm(this.drawer, {
      eyebrow: 'Agency · Email',
      title: 'Email signature',
      intro: `A few lines under every email to owners and tenants, for example your trading name, phone, website and registration numbers. Up to ${EMAIL_SIGNATURE_LINES} lines.`,
      fields: [{ key: 'signature', label: 'Signature', type: 'textarea', placeholder: `${a.details.shortName}\n${a.details.phone || 'Phone'} · ${a.details.email || 'email'}` }],
      initial: { signature: a.emailSignature ?? '' },
      submitLabel: 'Save',
      submit: (f) => this.data.updateEmailSignature(f['signature'] ?? '', a.version),
      success: (_r, f) => ((f['signature'] ?? '').trim() ? 'Emails now carry the new signature.' : 'The signature was removed.'),
      failure: 'The signature wasn’t saved',
    });
  }

  protected change(t: SchemeTrustAccount): void {
    trustAccountForm(this.drawer, this.data, t);
  }

  /** D25: the scheme's own Payfast account, so owners can pay online. A fresh passkey, like the trust account. */
  protected linkPayfast(t: SchemeTrustAccount): void {
    openForm(this.drawer, {
      eyebrow: `${t.scheme.name} · Online payments`,
      title: 'Set up Payfast',
      intro:
        `Use the scheme’s own Payfast account, set to pay out to its trust account (${t.account.bank} ····${t.account.accountNumber.slice(-4)}). ` +
        'Find these in Payfast under Settings › Integration. Set a salt passphrase there first. Payfast confirms each payment to Humo PM, which credits the owner’s account.',
      fields: [
        { key: 'merchantId', label: 'Merchant ID', type: 'text', required: true, half: true },
        { key: 'merchantKey', label: 'Merchant key', type: 'text', required: true, half: true },
        { key: 'passphrase', label: 'Salt passphrase', type: 'password', required: true, help: 'Kept encrypted. Humo PM never shows it again.' },
      ],
      submitLabel: 'Verify and link',
      stepUp: { action: 'change-bank-details', detail: `Link a Payfast account for owners of ${t.scheme.name} to pay into` },
      submit: (f) => this.data.linkPayfast(t.scheme.id, { merchantId: f['merchantId'].trim(), merchantKey: f['merchantKey'].trim(), passphrase: f['passphrase'] }),
      success: () => `Online payments are on for ${t.scheme.name}. Owners see “Pay with Payfast” on their account.`,
      failure: 'Payfast wasn’t linked',
    });
  }

  protected unlinkPayfast(t: SchemeTrustAccount): void {
    openForm(this.drawer, {
      eyebrow: `${t.scheme.name} · Online payments`,
      title: 'Turn off online payments',
      intro: 'Owners pay by EFT again. Payments already started on Payfast still count when Payfast confirms them.',
      fields: [REASON_FIELD],
      submitLabel: 'Turn off',
      stepUp: { action: 'change-bank-details', detail: `Turn off online payments for ${t.scheme.name}` },
      submit: (f) => this.data.unlinkPayfast(t.scheme.id, f['reason']),
      success: () => `Online payments are off for ${t.scheme.name}.`,
      failure: 'Online payments weren’t turned off',
    });
  }
}
