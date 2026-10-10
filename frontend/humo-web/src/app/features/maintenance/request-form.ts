import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, debounceTime, of, switchMap } from 'rxjs';
import { FieldErrors, JobDataSource, PRIORITY_LABEL, Priority, Trade, UnitDataSource, UnitSummary, describeFailure, fieldErrorsOf } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { FieldError } from '../../ui/form/field-error';
import { PageHeader } from '../../ui/page-header/page-header';
import { PhotoTile } from '../../ui/photo/photo-tile';

interface TradeTile {
  trade: Trade;
  label: string;
  icon: string;
}

const TILES: TradeTile[] = [
  { trade: 'Plumbing', label: 'Water & leaks', icon: 'water-outline' },
  { trade: 'Electrical', label: 'Electrical & lights', icon: 'flash-outline' },
  { trade: 'Roofing & waterproofing', label: 'Roof & damp', icon: 'umbrella-outline' },
  { trade: 'Security', label: 'Security & intercom', icon: 'shield-outline' },
  { trade: 'Gate automation', label: 'Gates & remotes', icon: 'car-outline' },
  { trade: 'Lifts', label: 'Lifts', icon: 'swap-vertical-outline' },
  { trade: 'Gardens', label: 'Garden & trees', icon: 'leaf-outline' },
  { trade: 'Pest control', label: 'Pests', icon: 'bug-outline' },
  { trade: 'Building', label: 'Walls, paving & other', icon: 'hammer-outline' },
];

/**
 * Reporting a problem. One form, two audiences:
 * - staff: any scheme/unit, priority, who reported it
 * - residents: their unit or common property, plain-language categories,
 *   one urgency question, photos — designed for a phone.
 */
@Component({
  selector: 'app-request-form',
  imports: [PageHeader, PhotoTile, IonIcon, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './request-form.html',
  styleUrl: './request-form.scss',
})
export class RequestForm {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly jobs = inject(JobDataSource);
  private readonly units = inject(UnitDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);

  /** Set by the route data: staff or resident flavour. */
  protected readonly mode = signal<'staff' | 'resident'>(this.route.snapshot.data['mode'] ?? 'staff');

  protected readonly tiles = TILES;
  protected readonly priorities = Object.keys(PRIORITY_LABEL) as Priority[];
  protected readonly priorityLabel = PRIORITY_LABEL;

  protected readonly schemeId = signal<string>(this.route.snapshot.queryParamMap.get('scheme') ?? '');
  protected readonly where = signal<'unit' | 'common'>('unit');
  protected readonly unitQuery = signal('');
  protected readonly unit = signal<UnitSummary | null>(null);
  protected readonly location = signal('');
  protected readonly category = signal<Trade | null>(null);
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly priority = signal<Priority>('normal');
  protected readonly urgent = signal<boolean | null>(null);
  protected readonly reporterName = signal('');
  protected readonly reporterRole = signal<'owner' | 'tenant' | 'trustee' | 'staff'>('staff');
  protected readonly photos = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly attempted = signal(false);
  /** What the server said about the last attempt, per field. */
  protected readonly serverErrors = signal<FieldErrors>({});

  /** Residents: their own unit, from their membership. */
  private readonly ownUnit = toSignal(
    toObservable(computed(() => (this.mode() === 'resident' ? this.session.assignment() : null))).pipe(
      switchMap((m) =>
        m?.scope.unitId ? this.units.byId(m.scope.unitId).pipe(catchError(() => of(undefined))) : of(undefined),
      ),
    ),
  );

  protected readonly unitResults = toSignal(
    toObservable(computed(() => ({ q: this.unitQuery(), scheme: this.schemeId() }))).pipe(
      debounceTime(120),
      switchMap(({ q, scheme }) => (q.trim() && scheme ? this.units.search(/^\d+$/.test(q.trim()) ? q.trim() : q, [scheme], 6).pipe(catchError(() => of([] as UnitSummary[]))) : of([] as UnitSummary[]))),
    ),
    { initialValue: [] as UnitSummary[] },
  );

  constructor() {
    effect(() => {
      const scoped = this.scope.scopeId();
      untracked(() => {
        if (!this.schemeId() && scoped) this.schemeId.set(scoped);
      });
    });
    effect(() => {
      const own = this.ownUnit();
      if (own) untracked(() => this.unit.set(own));
    });
    if (this.session.isResident()) this.reporterRole.set(this.session.role() as 'owner' | 'tenant');
  }

  protected readonly errors = computed(() => {
    const e: string[] = [];
    const resident = this.mode() === 'resident';
    if (!resident && !this.schemeId()) e.push('Choose the scheme');
    if (this.where() === 'unit' && !this.unit()) e.push(resident ? 'We couldn’t find your unit' : 'Choose the unit, or switch to common property');
    if (this.where() === 'common' && !this.location().trim()) e.push('Say where on the property');
    if (!this.category()) e.push('Choose what kind of problem it is');
    if (!this.title().trim()) e.push('Give the problem a short title');
    if (resident && this.urgent() === null) e.push('Tell us whether it’s urgent');
    return e;
  });

  protected pickUnit(u: UnitSummary): void {
    this.unit.set(u);
    this.unitQuery.set('');
    if (this.reporterRole() === 'owner' && u.owners[0]) this.reporterName.set(u.owners[0].displayName);
    if (this.reporterRole() === 'tenant' && u.tenant) this.reporterName.set(u.tenant.displayName);
  }

  /** Field mode: "Report" on a phone opens this form photo-first (?capture=1). */
  protected readonly capture = signal(this.route.snapshot.queryParamMap.get('capture') === '1');

  /** The camera or the photo library. The prototype keeps each photo's name as its caption. */
  protected takePhotos(e: Event): void {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    const start = this.photos().length;
    this.photos.update((p) => [...p, ...files.map((f, i) => `Photo ${start + i + 1} — ${f.name.replace(/\.[^.]+$/, '')}`)]);
    (e.target as HTMLInputElement).value = '';
  }

  protected submit(): void {
    this.attempted.set(true);
    this.serverErrors.set({});
    if (this.errors().length) return;
    const resident = this.mode() === 'resident';
    const u = this.where() === 'unit' ? this.unit() : null;
    const schemeId = resident ? this.session.assignment().scope.schemeIds[0] : this.schemeId();
    const persona = this.session.identity();
    const reportedBy = resident
      ? { name: persona.name, role: this.session.role() as 'owner' | 'tenant', personId: persona.personId }
      : this.reporterRole() === 'staff'
        ? { name: persona.name, role: 'staff' as const }
        : { name: this.reporterName().trim() || 'Resident', role: this.reporterRole() };
    this.busy.set(true);
    this.jobs
      .create({
        schemeId,
        unitId: u?.unit.id,
        location: u ? `Unit ${u.unit.number}${this.location().trim() ? ' — ' + this.location().trim() : ''}` : this.location().trim(),
        title: this.title().trim(),
        description: this.description().trim() || this.title().trim(),
        category: this.category()!,
        priority: resident ? (this.urgent() ? 'urgent' : 'normal') : this.priority(),
        reportedBy,
        photoCaptions: this.photos(),
      })
      .subscribe({
        next: (ref) => {
          this.busy.set(false);
          if (resident) {
            this.feedback.success(`Thanks — your request ${ref} has been sent to the managing agent.`);
            this.router.navigateByUrl('/my/requests');
          } else {
            this.feedback.success(`${ref} logged — triage it next.`);
            this.router.navigate(['/maintenance', ref]);
          }
        },
        // Everything they typed stays in the form.
        error: (e) => {
          this.busy.set(false);
          this.serverErrors.set(fieldErrorsOf(e));
          this.feedback.error(describeFailure(e, 'We couldn’t send that'));
        },
      });
  }

  protected cancel(): void {
    history.back();
  }
}
