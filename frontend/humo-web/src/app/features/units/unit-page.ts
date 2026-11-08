import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { EMPTY, catchError, combineLatest, map, of, switchMap, take } from 'rxjs';
import {
  AccessDataSource,
  AccountDataSource,
  Person,
  PersonDataSource,
  PersonSummary,
  TimelineDataSource,
  TimelineEvent,
  UnitDataSource,
  UnitRole,
  UnitSummary,
  WorkItem,
  periodLabel,
} from '../../domain';
import { AttentionService } from '../../core/attention/attention.service';
import { loadable } from '../../core/data/loadable';
import { AgeingBar } from '../../ui/ageing/ageing-bar';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { editUnitForm } from '../schemes/scheme-forms';
import { REASON_FIELD, openForm } from '../shared/form-drawer';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { Timeline } from '../../ui/timeline/timeline';
import { WorkItemPreview } from '../my-work/work-item-preview';
import { workItemView } from '../my-work/work-item-view';
import { OCCUPANCY_LABEL, accountStatus, balanceTone, links, ownerGapText, unitChain } from '../accounts/account-view';
import { LogNote } from '../shared/log-note';
import { AttachmentsPanel } from '../library/attachments-panel';
import { ScopeService } from '../../core/scope/scope.service';
import { inviteResidentForm } from '../access/user-forms';
import { addToUnitForm, editRelationshipForm, endRelationshipForm, newPersonForm, removeRelationshipForm } from '../people/person-forms';

/**
 * Unit record (Record page pattern P1). The middle of the most common journey:
 * Scheme → Unit → Owner → Account → Statement, with every link one click away
 * and the unit's whole history in one timeline.
 */
@Component({
  selector: 'app-unit-page',
  imports: [AttachmentsPanel, RecordHeader, StatusPill, AgeingBar, Timeline, LogNote, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
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
  private readonly router = inject(Router);
  private readonly sessionService = inject(SessionService);
  private readonly scope = inject(ScopeService);
  private readonly access = inject(AccessDataSource);

  protected canEdit(s: UnitSummary): boolean {
    return this.sessionService.can('Units.Manage') && !this.sessionService.readOnly() && s.scheme.status !== 'closed' && s.scheme.status !== 'archived';
  }

  /** Owners and tenants are added, corrected, ended and removed from the unit (People.Manage), unless the scheme has left the agency. */
  protected canManagePeople(s: UnitSummary): boolean {
    return this.sessionService.can('People.Manage') && !this.sessionService.readOnly() && s.scheme.status !== 'closed' && s.scheme.status !== 'archived';
  }

  protected roleOf(s: UnitSummary, personId: string, type: 'owner' | 'tenant'): UnitRole | undefined {
    return s.roles?.find((r) => r.current && r.person.id === personId && r.relationship.type === type);
  }

  protected pastRoles(s: UnitSummary): UnitRole[] {
    return (s.roles ?? []).filter((r) => !r.current);
  }

  private where(s: UnitSummary): string {
    return `Unit ${s.unit.number}, ${s.scheme.name}`;
  }

  /** Someone already in People: everyone in the schemes this person can see. */
  protected addExisting(s: UnitSummary): void {
    this.people
      .list(this.scope.accessible().map((x) => x.id), { page: 1, pageSize: 1000 })
      .pipe(take(1))
      .subscribe((page) => addToUnitForm(this.drawer, this.people, s, page.items.map((x) => x.person).sort((a, b) => a.displayName.localeCompare(b.displayName))));
  }

  protected addNew(s: UnitSummary): void {
    newPersonForm(this.drawer, this.people, this.units, this.scope.accessible(), this.router, s.scheme.id, s.unit.number);
  }

  protected endRole(s: UnitSummary, r: UnitRole): void {
    endRelationshipForm(this.drawer, this.people, r.person, { relationship: r.relationship, scheme: s.scheme, unit: s.unit });
  }

  protected editRole(s: UnitSummary, r: UnitRole): void {
    editRelationshipForm(this.drawer, this.people, r.person, r.relationship, this.where(s));
  }

  protected removeRole(s: UnitSummary, r: UnitRole): void {
    removeRelationshipForm(this.drawer, this.people, r.person, r.relationship, this.where(s));
  }

  /** D3: owners and tenants without a Humo sign-in can be invited from here, for schemes the inviter covers. */
  protected canInvite(s: UnitSummary, p: Person): boolean {
    return (
      !p.personaId &&
      this.sessionService.can('Residents.Invite') &&
      !this.sessionService.readOnly() &&
      this.scope.accessible().some((x) => x.id === s.scheme.id)
    );
  }

  protected invite(s: UnitSummary, p: Person, role: 'owner' | 'tenant'): void {
    const org = this.sessionService.organisation();
    if (org) inviteResidentForm(this.drawer, this.access, org.id, org.shortName, p, [{ role, scheme: s.scheme, unit: s.unit }]);
  }

  /** Only a unit added by mistake: the API refuses one with history and says what to do instead. */
  protected deleteUnit(s: UnitSummary): void {
    openForm(this.drawer, {
      eyebrow: `${s.scheme.name} · Unit ${s.unit.number}`,
      title: 'Delete this unit',
      intro: 'Only for a unit added by mistake. A unit with any history (charges, payments, statements, jobs, messages or documents) stays on record. If it was sold, add the new owner on their People record (they replace the old owner). If the whole scheme left the agency, close the scheme.',
      fields: [REASON_FIELD],
      submitLabel: 'Delete unit',
      submit: (f) => this.units.remove(s.unit.id, f['reason']),
      success: () => `Unit ${s.unit.number} was deleted.`,
      done: () => void this.router.navigate(['/schemes', s.scheme.id, 'units']),
      failure: 'The unit wasn’t deleted',
    });
  }

  protected editUnit(s: UnitSummary): void {
    editUnitForm(this.drawer, this.units, s.unit, s.scheme.name);
  }

  private readonly key = toSignal(
    this.route.paramMap.pipe(map((p) => ({ schemeId: p.get('schemeId')!, number: p.get('unitId')! }))),
    { initialValue: { schemeId: this.route.snapshot.paramMap.get('schemeId')!, number: this.route.snapshot.paramMap.get('unitId')! } },
  );

  /** D36: days when nobody owned this unit. */
  private readonly allGaps = loadable(() => this.units.ownerGaps([this.key().schemeId]));
  protected readonly gaps = computed(() => (this.allGaps.value() ?? []).filter((g) => g.unitNumber === this.key().number));
  protected readonly gapText = ownerGapText;

  /** undefined = loading; null = failed; false = not found. */
  protected readonly summary = loadable(() => {
    const k = this.key();
    return this.units.get(k.schemeId, k.number).pipe(map((s) => s ?? (false as const)));
  });

  private readonly unit = computed(() => {
    const s = this.summary.value();
    return s ? s : undefined;
  });

  protected readonly detail = toSignal(
    toObservable(this.unit).pipe(switchMap((s) => (s ? this.accounts.get(s.account.id).pipe(catchError(() => of(undefined))) : of(undefined)))),
  );

  /** Waits for the unit, then loads its history (its own retry, so one failure doesn't take the page down). */
  protected readonly timeline = loadable(() => {
    const s = this.unit();
    return s ? this.timelineData.forUnit(s.unit.id) : EMPTY;
  });

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
    return this.timeline.value() ?? [];
  }
}
