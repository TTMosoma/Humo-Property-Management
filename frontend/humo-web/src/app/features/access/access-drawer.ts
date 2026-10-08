import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DIALOG_DATA } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { EMPTY, Observable, catchError, map, of, switchMap } from 'rxjs';
import {
  AccessDataSource,
  CUSTOMER_ROLES,
  CustomerRole,
  FieldErrors,
  NewAssignment,
  PERMISSION_META,
  ROLE_LABELS,
  ROLE_META,
  ROLE_PERMISSIONS,
  RoleAssignment,
  RoleFamily,
  UnitDataSource,
  describeFailure,
  fieldErrorsOf,
} from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { ScopeService } from '../../core/scope/scope.service';
import { StepUpService } from '../../core/security/step-up.service';
import { SessionService } from '../../core/session/session.service';
import { Drawer } from '../../ui/drawer/drawer';
import { PrototypeControls } from '../../core/prototype/prototype-controls';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FieldError } from '../../ui/form/field-error';
import { editPersonDetailsForm, membershipForm } from './user-forms';
import { formatDate } from '../../ui/format/money';
import { FAMILY_LABELS, roleColor } from './access-view';

const GROUPS: RoleFamily[] = ['agency', 'governance', 'resident', 'supplier'];

/**
 * Manage one person's access: the roles they hold and where each applies.
 * Only customer roles can be granted here; Humo roles are managed by Humo.
 * Every grant or removal needs step-up, and nobody can change their own roles.
 */
@Component({
  selector: 'app-access-drawer',
  imports: [Drawer, IonIcon, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './access-drawer.html',
  styleUrl: './access-drawer.scss',
})
export class AccessDrawer {
  private readonly input = inject<{ identityId: string }>(DIALOG_DATA);
  private readonly access = inject(AccessDataSource);
  private readonly stepUp = inject(StepUpService);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  private readonly units = inject(UnitDataSource);
  protected readonly session = inject(SessionService);

  private readonly organisationId = this.session.organisation()?.id ?? '';
  protected readonly identity = toSignal(this.access.directory(this.organisationId).pipe(map((all) => all.find((i) => i.id === this.input.identityId))));
  private readonly here = computed(() => (this.identity()?.assignments ?? []).filter((m) => m.scope.organisationId === this.organisationId));
  protected readonly assignments = computed(() => this.here().filter((m) => m.status === 'active'));
  /** Ended assignments stay on record: who held what, and when it stopped. */
  protected readonly ended = computed(() => this.here().filter((m) => m.status === 'ended'));
  protected readonly isSelf = computed(() => this.input.identityId === this.session.actor().id);
  /** Their membership of this organisation (active, suspended). */
  protected readonly membership = computed(() => this.identity()?.memberships.find((m) => m.organisationId === this.organisationId));
  private readonly drawer = inject(DrawerService);
  /** Prototype only: lets a reviewer play the invitee accepting. */
  protected readonly prototype = inject(PrototypeControls, { optional: true });

  protected editDetails(): void {
    const who = this.identity();
    if (who) editPersonDetailsForm(this.drawer, this.access, who);
  }

  protected setMembership(status: 'active' | 'suspended' | 'ended'): void {
    const who = this.identity();
    if (who) membershipForm(this.drawer, this.access, who, this.organisationId, status);
  }

  protected resend(): void {
    const who = this.identity();
    if (!who) return;
    this.access.resendInvite(who.id).subscribe({
      next: () => this.feedback.success(`Invitation sent to ${who.email} again.`),
      error: (e) => this.feedback.error(describeFailure(e, 'The invitation wasn’t sent')),
    });
  }

  protected acceptInvite(): void {
    const who = this.identity();
    if (!who || !this.prototype) return;
    this.prototype.acceptInvite(who.id);
    this.feedback.success(`${who.name} accepted the invitation and set up a passkey. They can sign in now.`);
  }

  // ---- Add a role ----
  protected readonly adding = signal(false);
  protected readonly role = signal<CustomerRole>('portfolio-manager');
  protected readonly allSchemes = signal(false);
  protected readonly schemeIds = signal<string[]>([]);
  protected readonly unit = signal('');
  protected readonly supplier = signal('');
  protected readonly busy = signal(false);
  /** The server's verdict on the last attempt, per field. Cleared when the person edits the form. */
  protected readonly errors = signal<FieldErrors>({});
  protected readonly confirmRemove = signal<string | null>(null);

  protected readonly schemes = this.scope.accessible;
  protected readonly meta = computed(() => ROLE_META[this.role()]);
  protected readonly groups = GROUPS.map((f) => ({
    label: FAMILY_LABELS[f],
    roles: CUSTOMER_ROLES.filter((r) => ROLE_META[r].family === f),
  }));

  /** A taste of what the role can do, from the same permission table the API will use. */
  protected readonly preview = computed(() => ROLE_PERMISSIONS[this.role()].filter((p) => p !== 'Security.ManageOwn').slice(0, 5).map((p) => PERMISSION_META[p].label));

  protected readonly scopeValid = computed(() => {
    switch (this.meta().scopeKind) {
      case 'schemes':
        return this.role() === 'trustee' ? this.schemeIds().length === 1 : this.allSchemes() || this.schemeIds().length > 0;
      case 'unit':
        return this.schemeIds().length === 1 && this.unit().trim().length > 0;
      case 'supplier':
        return this.supplier().trim().length > 1;
      default:
        return true;
    }
  });

  protected readonly roleLabels = ROLE_LABELS;
  protected readonly roleMeta = ROLE_META;
  protected readonly roleColor = roleColor;
  protected readonly formatDate = formatDate;

  protected pickRole(r: string): void {
    this.errors.set({});
    this.role.set(r as CustomerRole);
    this.schemeIds.set([]);
    this.allSchemes.set(r === 'finance');
  }

  protected toggleScheme(id: string, single: boolean): void {
    this.errors.set({});
    if (single) {
      this.schemeIds.set([id]);
      return;
    }
    this.schemeIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected grant(): void {
    const name = this.identity()?.name ?? 'this person';
    const admin = this.role() === 'agency-admin';
    this.busy.set(true);
    this.errors.set({});
    this.buildAssignment()
      .pipe(
        switchMap((a) => {
          if (!a) return EMPTY;
          return this.stepUp
            .guard({ action: admin ? 'add-administrator' : 'change-roles', detail: `Give ${name} the ${ROLE_LABELS[a.role]} role · ${a.label}` }, () =>
              this.access.assign(this.input.identityId, a),
            )
            .pipe(map(() => a));
        }),
      )
      .subscribe({
        next: (a) => {
          this.adding.set(false);
          this.feedback.success(`${name} is now also ${ROLE_LABELS[a.role]} (${a.label}). They’ll see it in Switch role next time they open Humo Property Management.`);
        },
        // The form keeps everything they chose; field problems show next to the fields.
        error: (e) => {
          this.busy.set(false);
          this.errors.set(fieldErrorsOf(e));
          this.feedback.error(describeFailure(e, 'The role wasn’t granted'));
        },
        complete: () => this.busy.set(false),
      });
  }

  protected remove(m: RoleAssignment): void {
    const name = this.identity()?.name ?? 'this person';
    this.confirmRemove.set(null);
    this.stepUp
      .guard({ action: 'change-roles', detail: `End ${ROLE_LABELS[m.role]} · ${m.label} for ${name}` }, () => this.access.endAssignment(this.input.identityId, m.id, m.version))
      .subscribe({
        next: () => this.feedback.success(`Ended ${ROLE_LABELS[m.role]} for ${name}. It takes effect on their next request and stays in their access history.`),
        error: (e) => this.feedback.error(describeFailure(e, 'The role wasn’t ended')),
      });
  }

  /** The assignment to request; null (with a field error) when the unit can't be found. */
  private buildAssignment(): Observable<NewAssignment | null> {
    const role = this.role();
    const kind = this.meta().scopeKind;
    const org = this.organisationId;
    const names = this.schemeIds().map((id) => this.scope.findScheme(id)?.name ?? id);
    if (kind === 'agency') return of({ role, scope: { type: 'organisation', organisationId: org, schemeIds: [] }, label: this.session.organisation()?.shortName ?? 'Agency' });
    if (kind === 'supplier') return of({ role, scope: { type: 'organisation', organisationId: org, schemeIds: [] }, label: this.supplier().trim() });
    if (kind === 'unit') {
      const number = this.unit().trim().replace(/^unit\s*/i, '');
      const schemeId = this.schemeIds()[0];
      // People say "unit 42"; the assignment points at the unit itself.
      return this.units.get(schemeId, number).pipe(
        catchError(() => of(undefined)),
        map((u) => {
          if (!u) {
            this.errors.set({ unit: `There’s no unit ${number} in ${names[0]}.` });
            this.busy.set(false);
            return null;
          }
          return { role, scope: { type: 'unit', organisationId: org, schemeIds: [schemeId], unitId: u.unit.id }, label: `Unit ${u.unit.number}, ${names[0]}` };
        }),
      );
    }
    if (this.allSchemes() && role !== 'trustee') return of({ role, scope: { type: 'organisation', organisationId: org, schemeIds: [] }, label: 'All schemes' });
    return of({ role, scope: { type: 'schemes', organisationId: org, schemeIds: this.schemeIds() }, label: names.length <= 3 ? names.join(', ') : `${names.length} schemes` });
  }
}
