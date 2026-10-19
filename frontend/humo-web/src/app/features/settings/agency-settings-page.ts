import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { LARGE_APPROVAL_AMOUNT, OrganisationDataSource, SchemeTrustAccount, SettingsDataSource } from '../../domain';
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
        <h2 class="section-title">Trust accounts</h2>
        <p class="muted">Each scheme’s levies are paid into its own trust account. Statements and collection letters show these details. Changing one needs a fresh passkey or Humo Mobile approval and stays unverified until the bank’s letter is on file.</p>
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
            <ng-template uiCell="action" let-t>
              @if (canManage()) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="change(t)"><ion-icon name="finger-print-outline" aria-hidden="true" /> Change</button>
              }
            </ng-template>
          </ui-data-table>
        }
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
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
    { key: 'scheme', header: 'Scheme', mobile: 'title', sort: (t) => t.scheme.name },
    { key: 'bank', header: 'Bank', width: '30%' },
    { key: 'number', header: 'Account number', width: '170px' },
    { key: 'verified', header: '', width: '170px', sort: (t) => (t.verified ? 1 : 0) },
    { key: 'action', header: '', align: 'end', width: '110px' },
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

  protected change(t: SchemeTrustAccount): void {
    trustAccountForm(this.drawer, this.data, t);
  }
}
