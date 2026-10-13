import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, of } from 'rxjs';
import {
  CommercialAddOn,
  CommercialDataSource,
  CommercialPackage,
  FEATURE_META,
  HumoTeamDataSource,
  HumoTeamMember,
  PRICE_STATUS_LABELS,
  PRORATION_LABELS,
  PackageTerms,
  PriceStatus,
  isoDay,
  packageById,
  termsOn,
} from '../../../domain';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatDate, formatRand } from '../../../ui/format/money';
import { PageHeader } from '../../../ui/page-header/page-header';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';
import { addOnForm, packageTermsForm, settingsForm } from './commercial-forms';

const STATUS_TONE: Record<PriceStatus, 'neutral' | 'warning' | 'success'> = { awaiting: 'neutral', proposed: 'warning', approved: 'success' };

/**
 * Platform › Pricing & add-ons (docs/23): the commercial terms of each
 * package, the add-on catalogue, and the commercial settings. Every change is
 * effective-dated and kept as a version; existing agreements keep their price.
 * System Administrators edit; Account Managers and Executives read.
 */
@Component({
  selector: 'app-pricing-page',
  imports: [PageHeader, StatusPill, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header
      eyebrow="Humo platform"
      title="Pricing & add-ons"
      subtitle="What Humo charges for each package and add-on, from which date. A price change applies to new agreements from its date; customers keep the price they agreed."
    />
    <p class="demo-note"><ion-icon name="flask-outline" aria-hidden="true" /> Base package prices haven’t been decided, so they show as awaiting configuration. Values marked proposed are examples for the demo, not approved prices.</p>

    @if (cat(); as c) {
      <h2 class="section-title">Packages</h2>
      <p class="muted">Package names and features come from <a routerLink="/platform/packages">Packages &amp; features</a>; this is their commercial terms.</p>
      <div class="cards">
        @for (p of c.packages; track p.packageId) {
          @let t = current(p);
          <article class="card surface">
            <header>
              <h3>{{ name(p.packageId) }}</h3>
              @if (canEditCatalogue()) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="editPackage(p)"><ion-icon name="create-outline" aria-hidden="true" /> New terms</button>
              }
            </header>
            @if (t) {
              <div class="price">
                <strong>{{ t.monthlyPrice === null ? 'No price yet' : rand(t.monthlyPrice) + ' / month' }}</strong>
                <ui-status-pill [label]="statusLabel[t.priceStatus]" [tone]="tone[t.priceStatus]" />
              </div>
              <dl>
                <dt>Annual</dt><dd>{{ t.annualPrice === null ? '—' : rand(t.annualPrice) }}</dd>
                <dt>Storage</dt><dd>{{ t.includedStorageGb === null ? 'Negotiated' : t.includedStorageGb + ' GB' }} <span class="muted">({{ statusLabel[t.storageStatus].toLowerCase() }})</span></dd>
                <dt>Portfolio</dt><dd>{{ t.includedSchemes === null ? 'Not priced by portfolio size' : t.includedSchemes + ' schemes, then ' + (t.extraSchemePrice === null ? 'price to be set' : rand(t.extraSchemePrice) + ' per scheme') }}</dd>
                <dt>Renewal fee</dt><dd>{{ t.annualRenewalFee === null ? 'None' : rand(t.annualRenewalFee) + ' a year, on the renewal date' }}</dd>
                <dt>Billing</dt><dd>{{ p.billingFrequencies.join(' or ') }}</dd>
              </dl>
              @for (f of future(p.terms); track f.version) {
                <p class="future"><ion-icon name="calendar-outline" aria-hidden="true" /> From {{ date(f.effectiveFrom) }}: {{ f.monthlyPrice === null ? 'price awaiting configuration' : rand(f.monthlyPrice) + ' / month' }} ({{ statusLabel[f.priceStatus].toLowerCase() }})</p>
              }
              <details>
                <summary>{{ p.terms.length }} version{{ p.terms.length === 1 ? '' : 's' }}</summary>
                <ol class="versions">
                  @for (v of p.terms; track v.version) {
                    <li>v{{ v.version }} from {{ date(v.effectiveFrom) }} · {{ v.changedBy }}, {{ date(v.changedAt) }} · “{{ v.reason }}”</li>
                  }
                </ol>
              </details>
            }
          </article>
        }
      </div>

      <header class="row-head">
        <h2 class="section-title">Add-ons</h2>
        @if (canEditCatalogue()) {
          <button type="button" class="btn btn-secondary btn-sm" (click)="newAddOn()"><ion-icon name="add-outline" aria-hidden="true" /> New add-on</button>
        }
      </header>
      <div class="surface table-wrap">
        <table class="table">
          <caption class="visually-hidden">Add-on catalogue</caption>
          <thead>
            <tr><th scope="col">Add-on</th><th scope="col">Price</th><th scope="col">Status</th><th scope="col">Includes</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            @for (a of c.addOns; track a.id) {
              @let t = currentAddOn(a);
              <tr [class.retired]="a.status === 'retired'">
                <th scope="row"><strong>{{ a.name }}</strong><span class="muted block">{{ a.description }}</span></th>
                <td>
                  {{ t?.price == null ? 'No price yet' : rand(t!.price!) + (t!.frequency === 'annual' ? ' / year' : ' / month') }}
                  @if (t) {
                    <ui-status-pill [label]="statusLabel[t.priceStatus]" [tone]="tone[t.priceStatus]" />
                  }
                  @for (f of future(a.terms); track f.version) {
                    <span class="muted block">From {{ date(f.effectiveFrom) }}: {{ f.price === null ? 'awaiting' : rand(f.price) }}</span>
                  }
                </td>
                <td>{{ a.status === 'retired' ? 'Retired' + (a.retiresOn ? ' ' + date(a.retiresOn) : '') : a.status === 'draft' ? 'Draft' : 'On sale' }}</td>
                <td class="muted">
                  {{ includes(a) }}
                  @if (t?.usageAllowance; as u) {
                    <span class="block">{{ u.included }} {{ u.unit }} a month; more is charged by usage</span>
                  }
                </td>
                <td class="end">
                  @if (canEditCatalogue()) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="editAddOn(a)">Edit</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <header class="row-head">
        <h2 class="section-title">Commercial settings</h2>
        @if (canEditSettings()) {
          <button type="button" class="btn btn-secondary btn-sm" (click)="editSettings()"><ion-icon name="create-outline" aria-hidden="true" /> Edit</button>
        }
      </header>
      <section class="surface settings">
        <div><span class="label-caps">Storage warnings</span><strong>{{ c.settings.storageThresholds[0] }}% and {{ c.settings.storageThresholds[1] }}%</strong></div>
        <div>
          <span class="label-caps">Mid-cycle changes</span><strong>{{ c.settings.proration === 'daily' ? 'Daily pro-rata' : 'From the next billing cycle' }}</strong>
          <span class="muted">{{ proration[c.settings.proration] }}{{ c.settings.prorationAwaitingApproval ? '. Awaiting business approval.' : '.' }}</span>
        </div>
        <div>
          <span class="label-caps">VAT</span><strong>{{ c.settings.tax.vatRegistered ? 'Registered: ' + c.settings.tax.ratePercent + '% charged' : 'Not charged' }}</strong>
          <span class="muted">{{ c.settings.tax.legalName }}{{ c.settings.tax.vatNumber ? ' · VAT ' + c.settings.tax.vatNumber : '' }}. Humo charges VAT only when this says it’s registered.</span>
        </div>
        <div><span class="label-caps">Payment terms</span><strong>{{ c.settings.paymentTermsDays }} days</strong></div>
        <div><span class="label-caps">Designated account manager</span><strong>{{ managerName(c.settings.designatedAccountManagerId) }}</strong><span class="muted">New customers go to them by default.</span></div>
        <div><span class="label-caps">Payment provider</span><strong>Not chosen yet</strong><span class="muted">The demo uses a simulated provider. Payfast, Peach Payments or another provider plugs in behind one interface (docs/23 §6).</span></div>
      </section>
    } @else {
      <ui-skeleton variant="tiles" [count]="3" />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .demo-note { margin: 0; display: flex; gap: var(--s-2); align-items: center; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); border-radius: var(--r); background: var(--c-info-soft, var(--c-neutral-soft)); }
    .muted { margin: 0; color: var(--c-text-muted); font-size: var(--fs-sm); }
    .block { display: block; }
    .section-title { margin: 0; }
    .row-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--s-3); }
    .card { display: flex; flex-direction: column; gap: var(--s-2); padding: var(--s-4); }
    .card header { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
    h3 { margin: 0; font-size: var(--fs-md); }
    .price { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 4px var(--s-3); margin: 0; font-size: var(--fs-sm); }
    dt { color: var(--c-text-muted); }
    dd { margin: 0; }
    .future { margin: 0; display: flex; gap: var(--s-2); align-items: center; font-size: var(--fs-sm); color: var(--c-warning); }
    details summary { cursor: pointer; font-size: var(--fs-sm); color: var(--c-text-muted); }
    .versions { margin: var(--s-2) 0 0; padding-left: var(--s-5); font-size: var(--fs-xs); color: var(--c-text-muted); }
    .table-wrap { overflow-x: auto; }
    .table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .table th, .table td { padding: var(--s-2) var(--s-3); text-align: left; vertical-align: top; border-bottom: 1px solid var(--c-border); font-weight: var(--fw-regular); }
    .table thead th { font-weight: var(--fw-medium); }
    .end { text-align: right !important; }
    tr.retired { opacity: 0.6; }
    .settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--s-4); padding: var(--s-4) var(--s-5); }
    .settings > div { display: flex; flex-direction: column; gap: 2px; }
  `,
})
export class PricingPage {
  private readonly data = inject(CommercialDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);
  private readonly team = toSignal(inject(HumoTeamDataSource).list().pipe(catchError(() => of([] as HumoTeamMember[]))), { initialValue: [] as HumoTeamMember[] });

  protected readonly cat = toSignal(this.data.catalogue().pipe(catchError(() => of(undefined))));
  protected readonly canEditCatalogue = computed(() => this.session.can('Platform.Packages.Manage') && !this.session.readOnly());
  protected readonly canEditSettings = computed(() => this.session.can('Platform.Config.Manage') && !this.session.readOnly());
  private readonly managers = computed(() =>
    this.team()
      .filter((m) => m.identity.status === 'active' && m.roles.some((r) => r.role === 'humo-account-manager'))
      .map((m) => ({ value: m.identity.id, label: m.identity.name })),
  );

  protected readonly statusLabel = PRICE_STATUS_LABELS;
  protected readonly tone = STATUS_TONE;
  protected readonly proration = PRORATION_LABELS;
  protected readonly name = (id: CommercialPackage['packageId']) => packageById(id).name;
  protected readonly date = (d: string) => formatDate(d);
  protected readonly rand = (n: number) => formatRand(n, { cents: false });
  private readonly today = isoDay(new Date());

  protected current(p: CommercialPackage): PackageTerms | undefined {
    return termsOn(p.terms, this.today) ?? p.terms.at(-1);
  }

  protected currentAddOn(a: CommercialAddOn) {
    return termsOn(a.terms, this.today) ?? a.terms.at(-1);
  }

  protected future<T extends { effectiveFrom: string }>(terms: T[]): T[] {
    return terms.filter((t) => t.effectiveFrom > this.today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }

  protected includes(a: CommercialAddOn): string {
    if (a.kind === 'storage') return a.storageGb ? `${a.storageGb} GB${a.allowQuantity ? ', can be bought more than once' : ''}` : 'Storage';
    return a.features.map((f) => FEATURE_META[f]?.label ?? f).join(', ');
  }

  protected managerName(id: string): string {
    return this.managers().find((m) => m.value === id)?.label ?? id;
  }

  protected editPackage(p: CommercialPackage): void {
    packageTermsForm(this.drawer, this.data, p, this.name(p.packageId));
  }

  protected newAddOn(): void {
    addOnForm(this.drawer, this.data);
  }

  protected editAddOn(a: CommercialAddOn): void {
    addOnForm(this.drawer, this.data, a);
  }

  protected editSettings(): void {
    const c = this.cat();
    if (c) settingsForm(this.drawer, this.data, c.settings, this.managers());
  }
}
