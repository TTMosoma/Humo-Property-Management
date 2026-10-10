import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { combineLatest, map } from 'rxjs';
import {
  CURRENT_ENVIRONMENT,
  ENVIRONMENTS,
  Environment,
  FLAG_KIND_LABELS,
  FeatureFlag,
  OpsDataSource,
  PlatformCustomer,
  PlatformDataSource,
  describeRule,
  evaluateFlag,
  flagBucket,
} from '../../../domain';
import { loadable } from '../../../core/data/loadable';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatDate } from '../../../ui/format/money';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';
import { flagRuleForm, killSwitchForm } from './flag-forms';

/** One flag: its rule per environment, who it reaches, a "check a customer" explainer, and its history. */
@Component({
  selector: 'app-flag-page',
  imports: [StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="btn btn-ghost btn-sm back" routerLink="/platform/flags"><ion-icon name="chevron-back-outline" aria-hidden="true" /> Feature flags</a>
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="3" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this flag" (retry)="result.retry()" /></div>
    } @else if (!flag()) {
      <div class="surface"><ui-empty-state illustration="not-found" title="No such flag" /></div>
    } @else {
      @let f = flag()!;
      <header class="head">
        <div>
          <div class="label-caps">{{ kindLabel() }} · owned by {{ f.owner }}</div>
          <h1>{{ f.name }}</h1>
          <code>{{ f.key }}</code>
          <p class="desc">{{ f.description }}</p>
          <p class="muted">Shows in: {{ f.affects }}</p>
        </div>
        @if (f.kind === 'kill-switch' && canManage()) {
          <button type="button" class="btn" [class.btn-danger]="f.rules.production.enabled" [class.btn-primary]="!f.rules.production.enabled" (click)="kill()">
            <ion-icon name="power-outline" aria-hidden="true" /> {{ f.rules.production.enabled ? 'Switch off everywhere' : 'Switch back on' }}
          </button>
        }
      </header>

      <div class="envs">
        @for (e of envs; track e.id) {
          @let r = f.rules[e.id];
          <section class="surface env" [class.prod]="e.id === 'production'">
            <div class="env-head">
              <h2>{{ e.label }}</h2>
              <ui-status-pill [label]="r.enabled ? 'On' : 'Off'" [tone]="r.enabled ? 'success' : 'neutral'" />
            </div>
            <p class="rule">{{ describe(e.id) }}</p>
            @if (e.id === 'production') {
              <p class="muted">Reaches {{ reach() }} of {{ customers().length }} customers now.</p>
              @if (r.allow.length) { <p class="muted">Always on for: {{ names(r.allow) }}</p> }
              @if (r.deny.length) { <p class="muted">Never on for: {{ names(r.deny) }}</p> }
            }
            @if (canManage()) {
              <button type="button" class="btn btn-secondary btn-sm" (click)="edit(e.id)">@if (e.id === 'production') { <ion-icon name="finger-print-outline" aria-hidden="true" /> } Change</button>
            }
          </section>
        }
      </div>

      <section class="surface panel">
        <h2 class="section-title">Check a customer</h2>
        <p class="muted">Is this flag on for a customer in production, and why?</p>
        <select (change)="checking.set($any($event.target).value)">
          <option value="">Choose a customer…</option>
          @for (c of customers(); track c.organisationId) {
            <option [value]="c.organisationId" [selected]="checking() === c.organisationId">{{ c.name }}</option>
          }
        </select>
        @if (explain(); as x) {
          <p class="explain" [class.on]="x.on"><strong>{{ x.on ? 'On' : 'Off' }}</strong> for {{ x.name }}: {{ x.why }}</p>
        }
      </section>

      <section class="surface panel">
        <h2 class="section-title">History</h2>
        <ul class="history">
          @for (h of f.history; track h.id) {
            <li>
              <div><strong>{{ h.summary }}</strong><span class="muted"> · {{ envName(h.environment) }}</span></div>
              <div class="muted">“{{ h.reason }}” — {{ h.by }}, {{ formatDate(h.at) }}</div>
            </li>
          } @empty {
            <li class="muted">No changes since it was created on {{ formatDate(f.createdAt) }}.</li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .back { align-self: flex-start; }
    .head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--s-3); }
    h1 { margin: 2px 0; font-size: var(--fs-2xl); }
    code { font-size: var(--fs-sm); color: var(--c-text-2); }
    .desc { margin: var(--s-2) 0 0; max-width: 70ch; }
    .muted { margin: 4px 0 0; font-size: var(--fs-sm); color: var(--c-text-muted); }
    .envs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-3); }
    .env { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s-1); padding: var(--s-4); }
    .env.prod { border: 1px solid var(--c-primary); }
    .env-head { display: flex; gap: var(--s-2); align-items: center; justify-content: space-between; width: 100%; }
    .env h2 { margin: 0; font-size: var(--fs-md); }
    .rule { margin: 0; font-weight: var(--fw-medium); }
    .env .btn { margin-top: auto; }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    select { margin-top: var(--s-2); max-width: 360px; }
    .explain { margin: var(--s-3) 0 0; padding: var(--s-2) var(--s-3); background: var(--c-surface-sunken); border-radius: var(--r); }
    .explain.on strong { color: var(--c-success); }
    .history { margin: 0; padding: 0; list-style: none; }
    .history li { padding: var(--s-2) 0; border-top: 1px solid var(--c-border); }
    .btn-danger { color: #fff; background: var(--c-danger); border-color: var(--c-danger); }
    @media (max-width: 900px) { .envs { grid-template-columns: 1fr; } }
  `,
})
export class FlagPage {
  private readonly route = inject(ActivatedRoute);
  private readonly ops = inject(OpsDataSource);
  private readonly platform = inject(PlatformDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);

  private readonly key = toSignal(this.route.paramMap.pipe(map((p) => p.get('flagKey')!)), { initialValue: this.route.snapshot.paramMap.get('flagKey')! });
  protected readonly result = loadable(() => combineLatest([this.ops.flags(), this.platform.customers().pipe(map((p) => p.items))]).pipe(map(([flags, customers]) => ({ flags, customers }))));
  protected readonly flag = computed<FeatureFlag | undefined>(() => this.result.value()?.flags.find((f) => f.key === this.key()));
  protected readonly customers = computed<PlatformCustomer[]>(() => [...(this.result.value()?.customers ?? [])].sort((a, b) => a.name.localeCompare(b.name)));
  protected readonly reach = computed(() => (this.flag() ? this.customers().filter((c) => evaluateFlag(this.flag()!, CURRENT_ENVIRONMENT, c.organisationId)).length : 0));
  protected readonly checking = signal('');

  protected readonly explain = computed(() => {
    const f = this.flag();
    const id = this.checking();
    if (!f || !id) return null;
    const r = f.rules.production;
    const name = this.customers().find((c) => c.organisationId === id)?.name ?? id;
    const bucket = flagBucket(f.key, id);
    const on = evaluateFlag(f, 'production', id);
    const why = !r.enabled
      ? 'the flag is switched off in production.'
      : r.deny.includes(id)
        ? 'they’re on the “never on” list.'
        : r.allow.includes(id)
          ? 'they’re on the “always on” list.'
          : `their place in the rollout is ${bucket} of 100, and the rollout is ${r.rollout}%${on ? '' : ` (they’ll get it once it reaches ${bucket + 1}%)`}.`;
    return { on, name, why };
  });

  protected readonly envs = ENVIRONMENTS;
  protected readonly canManage = computed(() => this.session.can('Platform.Config.Manage') && !this.session.readOnly());
  protected readonly kindLabel = computed(() => (this.flag() ? FLAG_KIND_LABELS[this.flag()!.kind] : ''));
  protected readonly formatDate = formatDate;
  protected readonly describe = (e: Environment) => describeRule(this.flag()!.rules[e]);
  protected readonly envName = (e: Environment) => ENVIRONMENTS.find((x) => x.id === e)!.label;
  protected readonly names = (ids: string[]) => ids.map((id) => this.customers().find((c) => c.organisationId === id)?.name ?? id).join(', ');

  protected edit(e: Environment): void {
    flagRuleForm(this.drawer, this.ops, this.flag()!, e, this.customers());
  }

  protected kill(): void {
    killSwitchForm(this.drawer, this.ops, this.flag()!);
  }
}
