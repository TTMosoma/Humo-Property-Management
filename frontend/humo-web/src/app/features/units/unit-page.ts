import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import {
  AccountDataSource,
  PersonDataSource,
  PersonSummary,
  TimelineDataSource,
  TimelineEvent,
  UnitDataSource,
  UnitSummary,
  WorkItem,
  periodLabel,
} from '../../domain';
import { AttentionService } from '../../core/attention/attention.service';
import { pageState } from '../../core/prototype/page-state';
import { AgeingBar } from '../../ui/ageing/ageing-bar';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { Timeline } from '../../ui/timeline/timeline';
import { WorkItemPreview } from '../my-work/work-item-preview';
import { workItemView } from '../my-work/work-item-view';
import { OCCUPANCY_LABEL, accountStatus, balanceTone, links, unitChain } from '../accounts/account-view';
import { LogNote } from '../shared/log-note';

/**
 * Unit record (Record page pattern P1). The middle of the most common journey:
 * Scheme → Unit → Owner → Account → Statement, with every link one click away
 * and the unit's whole history in one timeline.
 */
@Component({
  selector: 'app-unit-page',
  imports: [RecordHeader, StatusPill, AgeingBar, Timeline, LogNote, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unit-page.html',
  styleUrl: './unit-page.scss',
})
export class UnitPage {
  private readonly route = inject(ActivatedRoute);
  private readonly units = inject(UnitDataSource);
  private readonly accounts = inject(AccountDataSource);
  private readonly people = inject(PersonDataSource);
  private readonly timelineData = inject(TimelineDataSource);
  private readonly attention = inject(AttentionService);
  private readonly drawer = inject(DrawerService);
  protected readonly page = pageState();

  private readonly key = toSignal(
    this.route.paramMap.pipe(map((p) => ({ schemeId: p.get('schemeId')!, number: p.get('unitId')! }))),
    { initialValue: { schemeId: this.route.snapshot.paramMap.get('schemeId')!, number: this.route.snapshot.paramMap.get('unitId')! } },
  );

  /** undefined = loading; null = failed; false = not found. */
  protected readonly summary = toSignal(
    toObservable(this.key).pipe(
      switchMap((k) =>
        this.units.get(k.schemeId, k.number).pipe(
          map((s) => s ?? (false as const)),
          catchError(() => of(null)),
        ),
      ),
    ),
  );

  private readonly unit = computed(() => {
    const s = this.summary();
    return s ? s : undefined;
  });

  protected readonly detail = toSignal(
    toObservable(this.unit).pipe(switchMap((s) => (s ? this.accounts.get(s.account.id).pipe(catchError(() => of(undefined))) : of(undefined)))),
  );

  protected readonly timeline = toSignal(
    toObservable(this.unit).pipe(
      switchMap((s) => (s ? this.timelineData.forUnit(s.unit.id).pipe(catchError(() => of(null))) : of(undefined))),
    ),
  );

  /** Owners' other roles (e.g. "also Chairperson of the trustees"). */
  protected readonly ownerProfiles = toSignal(
    toObservable(this.unit).pipe(
      switchMap((s) =>
        s && s.owners.length
          ? combineLatest(s.owners.map((o) => this.people.get(o.id))).pipe(catchError(() => of([] as (PersonSummary | undefined)[])))
          : of([] as (PersonSummary | undefined)[]),
      ),
    ),
    { initialValue: [] as (PersonSummary | undefined)[] },
  );

  protected readonly openWork = computed(() => {
    const s = this.unit();
    if (!s) return [];
    return this.attention.openForScheme(s.scheme.id).filter((w) => w.unitLabel === `Unit ${s.unit.number}`);
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const s = this.unit();
    if (!s) return [];
    const a = s.account;
    return [
      { label: 'Balance', value: formatRand(a.balance), tone: balanceTone(a) },
      { label: 'Monthly levy', value: formatRand(s.unit.monthlyLevy) },
      { label: 'Participation quota', value: `${s.unit.participationQuota.toFixed(4)}%` },
      { label: 'Size', value: `${s.unit.sizeM2} m²` },
      { label: 'Occupancy', value: OCCUPANCY_LABEL[s.unit.occupancy] },
    ];
  });

  protected readonly chain = computed(() => {
    const s = this.unit();
    return s ? unitChain(s, s.account) : [];
  });

  protected readonly occupancy = OCCUPANCY_LABEL;
  protected readonly formatDate = formatDate;
  protected readonly links = links;
  protected readonly periodLabel = periodLabel;

  protected status(s: UnitSummary) {
    return accountStatus(s.account);
  }

  protected otherRoles(personId: string): string[] {
    const s = this.unit();
    const profile = this.ownerProfiles().find((p) => p?.person.id === personId);
    if (!profile || !s) return [];
    return profile.relationships
      .filter((r) => !(r.relationship.type === 'owner' && r.unit?.id === s.unit.id))
      .map((r) =>
        r.relationship.type === 'trustee'
          ? `${r.relationship.portfolio} of the trustees`
          : `${r.relationship.type === 'owner' ? 'Owner' : 'Tenant'} of ${r.scheme.code} ${r.unit?.number}`,
      );
  }

  protected since(iso: string | undefined): string {
    return formatDate(iso);
  }

  protected work(w: WorkItem) {
    return workItemView(w);
  }

  protected openWorkItem(id: string, title: string): void {
    this.drawer.open(WorkItemPreview, { id }, title);
  }

  protected timelineEvents(): TimelineEvent[] {
    return (this.timeline() as TimelineEvent[] | null | undefined) ?? [];
  }
}
