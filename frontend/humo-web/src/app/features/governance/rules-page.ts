import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map, of, take } from 'rxjs';
import { BREACH_STATUS_LABELS, BreachStatus, BreachView, RULE_CATEGORY_LABELS, ResolutionDataSource, RulesDataSource, SchemeRule, UnitDataSource } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill, Tone } from '../../ui/status-pill/status-pill';
import { addRuleForm, amendRuleForm, logBreachForm, repealRuleForm } from './rules-forms';

export const BREACH_TONE: Record<BreachStatus, Tone> = { open: 'warning', warned: 'info', 'final-warning': 'warning', 'with-trustees': 'danger', resolved: 'success' };

/**
 * Governance › Scheme rules: a scheme's rule register (each rule's wording,
 * adoption and history, shared with owners as a rule book) and the breach
 * log across the schemes in scope.
 */
@Component({
  selector: 'app-rules-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Governance" title="Scheme rules" subtitle="Each scheme’s conduct rules, how and when they were adopted, and the breaches reported. Rules change only by resolution of the owners.">
      @if (state().tab === 'breaches' && canEnforce()) {
        <button type="button" class="btn btn-primary" (click)="logBreach()"><ion-icon name="add-outline" aria-hidden="true" /> Log a breach</button>
      }
    </ui-page-header>
    <app-scope-notice />

    <ui-view-tabs label="Rules and breaches" [tabs]="mainTabs()" [active]="state().tab ?? 'rules'" (activeChange)="state.update((s) => ({ ...s, tab: $event }))" />

    @if ((state().tab ?? 'rules') === 'rules') {
      <div class="toolbar">
        <label class="field">
          <span>Scheme</span>
          <select [value]="schemeId()" (change)="setScheme($any($event.target).value)">
            @for (s of schemes(); track s.id) {
              <option [value]="s.id" [selected]="s.id === schemeId()">{{ s.name }}</option>
            }
          </select>
        </label>
        @if (canManage() && rulesView(); as v) {
          <div class="tools">
            <button type="button" class="btn btn-secondary" (click)="addRule()"><ion-icon name="add-outline" aria-hidden="true" /> Add a rule</button>
            <button type="button" class="btn btn-primary" (click)="share()" [disabled]="sharing()"><ion-icon name="share-outline" aria-hidden="true" /> Share with owners</button>
          </div>
        }
      </div>

      @if (rules.loading()) {
        <ui-skeleton [count]="6" />
      } @else if (rules.failed()) {
        <div class="surface"><ui-error-state title="We couldn’t load the rules" (retry)="rules.retry()" /></div>
      } @else if (rulesView(); as v) {
        <p class="banner surface" [class.warn]="v.book.changedSinceShared || !v.book.shared">
          @if (v.book.shared; as sh) {
            Owners and residents have the rule book shared {{ formatDate(sh.at) }}
            (<a [routerLink]="['/documents', sh.documentId]">open it</a>).
            @if (v.book.changedSinceShared) {
              <strong>Rules have changed since: share the current version.</strong>
            }
          } @else {
            Owners don’t have a copy of these rules in Humo Property Management yet. Share them so they appear in the resident portal.
          }
        </p>

        @if (!v.rules.length) {
          <div class="surface"><ui-empty-state title="No rules captured yet" message="Add the scheme’s registered conduct rules, one by one." /></div>
        }
        @for (g of groups(); track g.label) {
          <section class="surface panel">
            <h2 class="section-title">{{ g.label }}</h2>
            @for (r of g.rules; track r.id) {
              <article class="rule" [class.repealed]="r.status === 'repealed'">
                <header>
                  <h3><span class="num">{{ r.number }}</span> {{ r.title }}</h3>
                  <div class="tags">
                    @if (r.status === 'repealed') {
                      <ui-status-pill label="Repealed" tone="neutral" />
                    }
                    @if (v.openBreaches[r.id]; as n) {
                      <button type="button" class="link" (click)="showBreaches()">{{ n }} open {{ n === 1 ? 'breach' : 'breaches' }}</button>
                    }
                  </div>
                </header>
                <p>{{ r.versions[0].text }}</p>
                <p class="muted">
                  @if (r.status === 'repealed') {
                    Repealed {{ formatDate(r.repealed!.at) }} · {{ r.repealed!.resolutionRef }}
                  } @else {
                    Adopted {{ formatDate(r.versions[0].adoptedAt) }} · {{ r.versions[0].resolutionRef }}
                  }
                  @if (r.versions.length > 1) {
                    · <button type="button" class="link" (click)="toggle(r.id)" [attr.aria-expanded]="open().has(r.id)">{{ r.versions.length - 1 }} earlier {{ r.versions.length === 2 ? 'version' : 'versions' }}</button>
                  }
                </p>
                @if (open().has(r.id)) {
                  <ol class="history">
                    @for (h of r.versions.slice(1); track h.adoptedAt) {
                      <li><p>{{ h.text }}</p><p class="muted">Adopted {{ formatDate(h.adoptedAt) }} · {{ h.resolutionRef }}</p></li>
                    }
                  </ol>
                }
                @if (r.status === 'in-force' && (canManage() || canEnforce())) {
                  <div class="act">
                    @if (canEnforce()) {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="logBreach(r)">Log a breach</button>
                    }
                    @if (canManage()) {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="amend(r)">Amend</button>
                      <button type="button" class="btn btn-ghost btn-sm" (click)="repeal(r)">Repeal</button>
                    }
                  </div>
                }
              </article>
            }
          </section>
        }
      }
    } @else {
      <ui-view-tabs label="Breach views" [tabs]="breachTabs()" [active]="state().view ?? 'open'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />
      @if (breaches.loading()) {
        <ui-skeleton [count]="6" />
      } @else if (breaches.failed()) {
        <div class="surface"><ui-error-state title="We couldn’t load the breach log" (retry)="breaches.retry()" /></div>
      } @else if (!breachRows().length) {
        <div class="surface"><ui-empty-state title="Nothing here" message="No breaches in this view." /></div>
      } @else {
        <ui-data-table caption="Breach log" [rows]="breachRows()" [columns]="breachColumns" [rowId]="breachId" (rowClick)="openBreach($event)">
          <ng-template uiCell="ref" let-b>
            <div class="title">{{ b.breach.ref }}</div>
            <div class="muted">{{ formatDate(b.breach.occurredAt, true) }}</div>
          </ng-template>
          <ng-template uiCell="where" let-b>
            <div>{{ b.unit.accountNo }} · {{ b.person.displayName }}</div>
            <div class="muted">{{ b.scheme.name }}{{ b.personRole === 'tenant' ? ' · tenant' : '' }}</div>
          </ng-template>
          <ng-template uiCell="rule" let-b>
            <div>{{ b.rule.number }} {{ b.rule.title }}</div>
            @if (b.repeats) {
              <div class="muted warn-text">{{ b.repeats }} earlier {{ b.repeats === 1 ? 'breach' : 'breaches' }} of this rule here</div>
            }
          </ng-template>
          <ng-template uiCell="status" let-b>
            <ui-status-pill [label]="statusLabel(b)" [tone]="tone(b)" />
            @if (b.breach.remedyBy && (b.breach.status === 'warned' || b.breach.status === 'final-warning')) {
              <div class="muted" [class.warn-text]="b.breach.remedyBy < today">Put right by {{ formatDate(b.breach.remedyBy, true) }}</div>
            }
          </ng-template>
        </ui-data-table>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--s-3); }
    .field { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .field select { min-width: 240px; }
    .tools { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .banner { margin: 0; padding: var(--s-3) var(--s-5); border-left: 3px solid var(--c-success); }
    .banner.warn { border-left-color: var(--c-warning); }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .rule { padding: var(--s-3) 0; border-top: 1px solid var(--c-border); }
    .rule:first-of-type { border-top: none; }
    .rule header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--s-2); }
    .rule h3 { margin: 0; font-size: var(--fs-base); }
    .rule p { margin: var(--s-1) 0 0; }
    .rule.repealed > p:not(.muted) { text-decoration: line-through; color: var(--c-text-muted); }
    .num { color: var(--c-text-muted); font-variant-numeric: tabular-nums; }
    .tags { display: flex; gap: var(--s-2); align-items: center; }
    .history { margin: var(--s-2) 0 0; padding-left: var(--s-5); border-left: 2px solid var(--c-border); }
    .history li { margin-bottom: var(--s-2); }
    .act { display: flex; gap: var(--s-1); margin-top: var(--s-2); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .warn-text { color: var(--c-warning); }
    .title { font-weight: var(--fw-medium); }
    .link { padding: 0; font: inherit; color: var(--c-link, var(--c-primary)); background: none; border: none; cursor: pointer; text-decoration: underline; }
  `,
})
export class RulesPage {
  private readonly router = inject(Router);
  private readonly data = inject(RulesDataSource);
  private readonly resolutions = inject(ResolutionDataSource);
  private readonly units = inject(UnitDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly state = urlState({ tab: 'rules', scheme: null, view: 'open' });
  protected readonly formatDate = formatDate;
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly open = signal(new Set<string>());
  protected readonly sharing = signal(false);

  protected readonly schemes = computed(() => this.scope.accessible().filter((s) => this.scope.effectiveIds().includes(s.id)));
  protected readonly schemeId = computed(() => {
    const chosen = this.state().scheme;
    const list = this.schemes();
    return chosen && list.some((s) => s.id === chosen) ? chosen : (list.find((s) => s.id === 'kingfisher-court') ?? list[0])?.id ?? '';
  });

  protected readonly rules = loadable(() => (this.schemeId() ? this.data.rules(this.schemeId()) : of(undefined)));
  protected readonly rulesView = computed(() => this.rules.value());
  protected readonly groups = computed(() => {
    const v = this.rulesView();
    if (!v) return [];
    const byCat = new Map<string, SchemeRule[]>();
    for (const r of v.rules) byCat.set(RULE_CATEGORY_LABELS[r.category], [...(byCat.get(RULE_CATEGORY_LABELS[r.category]) ?? []), r]);
    return [...byCat].map(([label, rules]) => ({ label, rules }));
  });

  protected readonly breaches = loadable(() => this.data.breaches(this.scope.effectiveIds()));
  private readonly allBreaches = computed(() => this.breaches.value() ?? []);
  private readonly isOpen = (b: BreachView) => b.breach.status !== 'resolved' && b.breach.status !== 'with-trustees';
  protected readonly mainTabs = computed(() => [
    { id: 'rules', label: 'Rules' },
    { id: 'breaches', label: 'Breach log', count: this.allBreaches().filter((b) => b.breach.status !== 'resolved').length },
  ]);
  protected readonly breachTabs = computed(() => [
    { id: 'open', label: 'Open', count: this.allBreaches().filter(this.isOpen).length },
    { id: 'with-trustees', label: 'With the trustees', count: this.allBreaches().filter((b) => b.breach.status === 'with-trustees').length },
    { id: 'resolved', label: 'Resolved' },
    { id: 'all', label: 'All' },
  ]);
  protected readonly breachRows = computed(() => {
    const v = this.state().view ?? 'open';
    return this.allBreaches()
      .filter((b) => (v === 'open' ? this.isOpen(b) : v === 'all' ? true : b.breach.status === v))
      .sort((a, b) => Number(a.breach.status === 'resolved') - Number(b.breach.status === 'resolved') || (a.breach.remedyBy ?? '9').localeCompare(b.breach.remedyBy ?? '9') || b.breach.occurredAt.localeCompare(a.breach.occurredAt));
  });
  protected readonly breachColumns: ColumnDef<BreachView>[] = [
    { key: 'ref', header: 'Breach', width: '130px', mobile: 'title', sort: (b) => b.breach.occurredAt },
    { key: 'where', header: 'Unit', sort: (b) => b.unit.accountNo },
    { key: 'rule', header: 'Rule', width: '28%', sort: (b) => b.rule.number },
    { key: 'status', header: 'Status', width: '200px', sort: (b) => b.breach.status },
  ];
  protected readonly breachId = (b: BreachView) => b.breach.id;
  protected readonly statusLabel = (b: BreachView) => BREACH_STATUS_LABELS[b.breach.status];
  protected readonly tone = (b: BreachView) => BREACH_TONE[b.breach.status];

  protected readonly canManage = computed(() => this.session.can('Meetings.Manage') && this.session.hasFeature('governance') && !this.session.readOnly());
  protected readonly canEnforce = computed(() => this.session.can('Rules.Enforce') && this.session.hasFeature('governance') && !this.session.readOnly());

  protected setScheme(id: string): void {
    this.state.update((s) => ({ ...s, scheme: id }));
  }

  protected toggle(id: string): void {
    this.open.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected showBreaches(): void {
    this.state.update((s) => ({ ...s, tab: 'breaches', view: 'open' }));
  }

  protected openBreach(b: BreachView): void {
    void this.router.navigate(['/governance/rules/breaches', b.breach.id]);
  }

  private passed() {
    return this.resolutions.list([this.schemeId()], { pageSize: 500 }).pipe(
      take(1),
      map((p) => p.items),
    );
  }

  protected addRule(): void {
    const v = this.rulesView()!;
    this.passed().subscribe((r) => addRuleForm(this.drawer, this.data, v, r));
  }

  protected amend(rule: SchemeRule): void {
    const v = this.rulesView()!;
    this.passed().subscribe((r) => amendRuleForm(this.drawer, this.data, v, rule, r));
  }

  protected repeal(rule: SchemeRule): void {
    const v = this.rulesView()!;
    this.passed().subscribe((r) => repealRuleForm(this.drawer, this.data, v, rule, r));
  }

  protected logBreach(rule?: SchemeRule): void {
    const v = this.rulesView();
    if (!v) return;
    this.units
      .list([v.scheme.id], { pageSize: 1000 })
      .pipe(take(1))
      .subscribe((p) => logBreachForm(this.drawer, this.data, this.router, v, [...p.items].sort((a, b) => a.unit.accountNo.localeCompare(b.unit.accountNo)), rule?.id));
  }

  protected share(): void {
    const v = this.rulesView()!;
    this.sharing.set(true);
    this.data.actRules(v.scheme.id, { type: 'share' }).subscribe({
      next: () => {
        this.sharing.set(false);
        this.feedback.success('Shared: owners and residents see the rule book in their documents.');
      },
      error: () => {
        this.sharing.set(false);
        this.feedback.error('The rule book wasn’t shared.');
      },
    });
  }
}
