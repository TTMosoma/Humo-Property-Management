import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { combineLatest, map } from 'rxjs';
import { ComplianceDataSource, ComplianceProfile, Scheme, SettingsDataSource } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { MONTHS, billingSettingsForm, complianceProfileForm } from './settings-forms';
import { DesktopHint } from '../../ui/states/desktop-hint';

interface YearRow {
  scheme: Scheme;
  profile: ComplianceProfile;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/**
 * Settings › Billing configuration: the rules billing, credit control and
 * compliance follow (interest, billing day, letter steps, AGM deadline) and
 * each scheme's financial year-end and lifts.
 */
@Component({
  selector: 'app-billing-settings-page',
  imports: [DesktopHint, PageHeader, DataTable, CellDef, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Settings" title="Billing configuration" subtitle="The rules billing runs, credit control and compliance follow, and each scheme’s financial year." />
    <ui-desktop-hint what="Changing billing configuration" />

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="3" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the configuration" (retry)="result.retry()" /></div>
    } @else {
      @let a = result.value()!.agency;
      <section class="surface panel">
        <div class="panel-head">
          <h2 class="section-title">Rules</h2>
          @if (canEditRules()) {
            <button type="button" class="btn btn-secondary btn-sm" (click)="editRules()">Edit</button>
          }
        </div>
        <dl class="rules">
          <div><dt>Interest on arrears</dt><dd>{{ a.billing.interestRate }}% a month</dd><p>Charged on amounts 30+ days overdue in each billing run; suspended for owners on an arrangement when the run says so.</p></div>
          <div><dt>Billing runs</dt><dd>Prepared on the {{ ord(a.billing.billingDay) }}</dd><p>Next month’s run for each scheme; posted after approval, dated the 1st.</p></div>
          <div><dt>Levies due</dt><dd>By the {{ ord(a.billing.dueDay) }}</dd><p>Printed on statements. Unpaid after this, the amount ages.</p></div>
          <div><dt>Collection letters</dt><dd>{{ a.billing.stepDays }} days apart</dd><p>Reminder → final demand → letter of demand (with the trustees’ approval) → attorney.</p></div>
          <div><dt>AGM deadline</dt><dd>{{ a.billing.agmMonths }} months after year-end</dd><p>The audited statements and CSOS return are due by the same date.</p></div>
        </dl>
      </section>

      <section class="surface panel">
        <h2 class="section-title">Financial years</h2>
        <p class="muted">Each scheme’s year-end sets its AGM, audit and CSOS deadlines in Compliance. Lifts add the lift inspection.</p>
        <ui-data-table caption="Financial years" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="editYear($event)">
          <ng-template uiCell="scheme" let-r>{{ r.scheme.name }}</ng-template>
          <ng-template uiCell="fye" let-r>{{ fye(r) }}</ng-template>
          <ng-template uiCell="lifts" let-r>{{ r.profile.hasLifts ? 'Yes' : 'No' }}</ng-template>
          <ng-template uiCell="action" let-r>
            @if (canEditYears()) {
              <button type="button" class="btn btn-ghost btn-sm" (click)="$event.stopPropagation(); editYear(r)">Change</button>
            }
          </ng-template>
        </ui-data-table>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .muted { margin: 0 0 var(--s-3); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .rules { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--s-4); margin: var(--s-2) 0 0; }
    .rules dt { font-size: var(--fs-xs); color: var(--c-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .rules dd { margin: 2px 0; font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
    .rules p { margin: 0; font-size: var(--fs-sm); color: var(--c-text-2); }
  `,
})
export class BillingSettingsPage {
  private readonly data = inject(SettingsDataSource);
  private readonly compliance = inject(ComplianceDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly result = loadable(() => {
    const schemes = this.scope.accessible();
    return combineLatest([this.data.agency(), this.compliance.profiles(schemes.map((s) => s.id))]).pipe(map(([agency, profiles]) => ({ agency, profiles })));
  });

  protected readonly rows = computed<YearRow[]>(() => {
    const profiles = new Map((this.result.value()?.profiles ?? []).map((p) => [p.schemeId, p]));
    return this.scope
      .accessible()
      .filter((s) => profiles.has(s.id))
      .map((scheme) => ({ scheme, profile: profiles.get(scheme.id)! }))
      .sort((a, b) => a.scheme.name.localeCompare(b.scheme.name));
  });

  protected readonly columns: ColumnDef<YearRow>[] = [
    { key: 'scheme', header: 'Scheme', mobile: 'title', sort: (r) => r.scheme.name },
    { key: 'fye', header: 'Year ends', width: '200px', sort: (r) => r.profile.financialYearEnd },
    { key: 'lifts', header: 'Lifts', width: '100px', sort: (r) => (r.profile.hasLifts ? 1 : 0) },
    { key: 'action', header: '', align: 'end', width: '110px' },
  ];
  protected readonly rowId = (r: YearRow) => r.scheme.id;
  protected readonly ord = ordinal;
  protected readonly fye = (r: YearRow) => `${new Date(2001, r.profile.financialYearEnd, 0).getDate()} ${MONTHS[r.profile.financialYearEnd - 1]}`;

  protected readonly canEditRules = computed(() => this.session.can('Billing.Run') && this.session.hasFeature('billing') && !this.session.readOnly());
  protected readonly canEditYears = computed(() => this.session.can('Compliance.Manage') && !this.session.readOnly());

  protected editRules(): void {
    billingSettingsForm(this.drawer, this.data, this.result.value()!.agency);
  }

  protected editYear(r: YearRow): void {
    if (this.canEditYears()) complianceProfileForm(this.drawer, this.data, r.scheme, r.profile);
  }
}
