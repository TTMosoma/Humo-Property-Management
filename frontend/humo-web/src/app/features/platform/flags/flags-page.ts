import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import { CURRENT_ENVIRONMENT, ENVIRONMENTS, Environment, FLAG_KIND_LABELS, FeatureFlag, OpsDataSource, PlatformDataSource, describeRule, evaluateFlag } from '../../../domain';
import { loadable } from '../../../core/data/loadable';
import { CellDef, ColumnDef, DataTable } from '../../../ui/data-table/data-table';
import { urlState } from '../../../ui/data-table/url-state';
import { ViewTabs } from '../../../ui/data-table/view-tabs';
import { PageHeader } from '../../../ui/page-header/page-header';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill, Tone } from '../../../ui/status-pill/status-pill';

interface Row {
  flag: FeatureFlag;
  reach: number;
}

/**
 * Platform › Feature flags: technical rollout, separate from what customers
 * pay for. Each flag's rule per environment, and how many customers it
 * reaches in production right now.
 */
@Component({
  selector: 'app-flags-page',
  imports: [PageHeader, ViewTabs, DataTable, CellDef, StatusPill, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Platform" title="Feature flags" subtitle="Switch code on per environment and roll it out customer by customer. Flags are technical; what customers pay for is in Packages & features, and both must allow a feature." />

    <ui-view-tabs label="Flag kinds" [tabs]="tabs()" [active]="state().kind ?? 'all'" (activeChange)="state.update((s) => ({ ...s, kind: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="8" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the flags" (retry)="result.retry()" /></div>
    } @else {
      <ui-data-table caption="Feature flags" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="flag" let-r>
          <div class="title">{{ r.flag.name }}</div>
          <div class="key">{{ r.flag.key }}</div>
          <div class="muted">{{ r.flag.affects }}</div>
        </ng-template>
        <ng-template uiCell="kind" let-r>
          <ui-status-pill [label]="kindLabel(r)" [tone]="kindTone(r)" />
          <div class="muted">{{ r.flag.owner }}</div>
        </ng-template>
        <ng-template uiCell="development" let-r><span [class.off]="!r.flag.rules.development.enabled">{{ rule(r, 'development') }}</span></ng-template>
        <ng-template uiCell="staging" let-r><span [class.off]="!r.flag.rules.staging.enabled">{{ rule(r, 'staging') }}</span></ng-template>
        <ng-template uiCell="production" let-r>
          <div [class.off]="!r.flag.rules.production.enabled">{{ rule(r, 'production') }}</div>
          <div class="muted">reaches {{ r.reach }} of {{ customers() }} customers</div>
        </ng-template>
      </ui-data-table>
      <p class="note">This prototype’s data stands for production. Changes to production need a fresh passkey or Humo Mobile approval and are in the audit log with their reason.</p>
    }
  `,
  styles: `
    :host { display: block; }
    .title { font-weight: var(--fw-medium); }
    .key { font-family: var(--font-mono, monospace); font-size: var(--fs-xs); color: var(--c-text-2); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .off { color: var(--c-text-muted); }
    .note { margin: var(--s-3) 0 0; font-size: var(--fs-xs); color: var(--c-text-muted); }
  `,
})
export class FlagsPage {
  private readonly router = inject(Router);
  private readonly ops = inject(OpsDataSource);
  private readonly platform = inject(PlatformDataSource);

  protected readonly state = urlState({ kind: null });
  protected readonly result = loadable(() => combineLatest([this.ops.flags(), this.platform.customers().pipe(map((p) => p.items))]).pipe(map(([flags, customers]) => ({ flags, customers }))));
  protected readonly customers = computed(() => this.result.value()?.customers.length ?? 0);

  private readonly all = computed<Row[]>(() => {
    const v = this.result.value();
    if (!v) return [];
    return v.flags.map((flag) => ({ flag, reach: v.customers.filter((c) => evaluateFlag(flag, CURRENT_ENVIRONMENT, c.organisationId)).length }));
  });
  protected readonly tabs = computed(() => [
    { id: 'all', label: 'All', count: this.all().length },
    ...(Object.keys(FLAG_KIND_LABELS) as FeatureFlag['kind'][]).map((k) => ({ id: k, label: FLAG_KIND_LABELS[k], count: this.all().filter((r) => r.flag.kind === k).length })).filter((t) => t.count),
  ]);
  protected readonly rows = computed(() => {
    const k = this.state().kind;
    return this.all().filter((r) => !k || k === 'all' || r.flag.kind === k);
  });

  protected readonly columns: ColumnDef<Row>[] = [
    { key: 'flag', header: 'Flag', mobile: 'title', sort: (r) => r.flag.name },
    { key: 'kind', header: 'Kind', width: '140px', sort: (r) => r.flag.kind },
    ...ENVIRONMENTS.map((e): ColumnDef<Row> => ({ key: e.id, header: e.label, width: e.id === 'production' ? '230px' : '150px', mobile: e.id === 'production' ? 'field' : 'hidden' })),
  ];
  protected readonly rowId = (r: Row) => r.flag.key;
  protected readonly rule = (r: Row, e: Environment) => describeRule(r.flag.rules[e]);
  protected readonly kindLabel = (r: Row) => FLAG_KIND_LABELS[r.flag.kind];
  protected readonly kindTone = (r: Row): Tone => ({ release: 'info', 'kill-switch': 'danger', ops: 'neutral', experiment: 'accent' }) [r.flag.kind] as Tone;

  protected open(r: Row): void {
    void this.router.navigate(['/platform/flags', r.flag.key]);
  }
}
