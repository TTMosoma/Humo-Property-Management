import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DIALOG_DATA } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import {
  AccessDataSource,
  CUSTOMER_ROLES,
  CustomerRole,
  NewAssignment,
  PERMISSION_META,
  ROLE_LABELS,
  ROLE_META,
  ROLE_PERMISSIONS,
  RoleAssignment,
  RoleFamily,
} from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { ScopeService } from '../../core/scope/scope.service';
import { StepUpService } from '../../core/security/step-up.service';
import { SessionService } from '../../core/session/session.service';
import { Drawer } from '../../ui/drawer/drawer';
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
  imports: [Drawer, IonIcon],
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
  protected readonly session = inject(SessionService);

  private readonly agencyId = this.session.agency()?.id ?? '';
  protected readonly identity = toSignal(this.access.directory(this.agencyId).pipe(map((all) => all.find((i) => i.id === this.input.identityId))));
  protected readonly assignments = computed(() => (this.identity()?.memberships ?? []).filter((m) => m.agencyId === this.agencyId));
  protected readonly isSelf = computed(() => this.input.identityId === this.session.actor().id);

  // ---- Add a role ----
  protected readonly adding = signal(false);
  protected readonly role = signal<CustomerRole>('portfolio-manager');
  protected readonly allSchemes = signal(false);
  protected readonly schemeIds = signal<string[]>([]);
  protected readonly unit = signal('');
  protected readonly supplier = signal('');
  protected readonly busy = signal(false);
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
    this.role.set(r as CustomerRole);
    this.schemeIds.set([]);
    this.allSchemes.set(r === 'finance');
  }

  protected toggleScheme(id: string, single: boolean): void {
    if (single) {
      this.schemeIds.set([id]);
      return;
    }
    this.schemeIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected grant(): void {
    const name = this.identity()?.name ?? 'this person';
    const a = this.buildAssignment();
    const admin = this.role() === 'agency-admin';
    this.busy.set(true);
    this.stepUp
      .guard(
        { action: admin ? 'add-administrator' : 'change-roles', detail: `Give ${name} the ${ROLE_LABELS[a.role]} role · ${a.label}` },
        () => this.access.assign(this.input.identityId, a),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.adding.set(false);
          this.feedback.success(`${name} is now also ${ROLE_LABELS[a.role]} (${a.label}). They’ll see it in Switch role next time they open Humo Property Management.`);
        },
        error: () => {
          this.busy.set(false);
          this.feedback.error('The role wasn’t granted. Nothing was changed.');
        },
        complete: () => this.busy.set(false),
      });
  }

  protected remove(m: RoleAssignment): void {
    const name = this.identity()?.name ?? 'this person';
    this.confirmRemove.set(null);
    this.stepUp
      .guard({ action: 'change-roles', detail: `Remove ${ROLE_LABELS[m.role]} · ${m.label} from ${name}` }, () => this.access.revoke(this.input.identityId, m.id))
      .subscribe({
        next: () => this.feedback.success(`Removed ${ROLE_LABELS[m.role]} from ${name}. It takes effect on their next request.`),
        error: () => this.feedback.error('The role wasn’t removed. Nothing was changed.'),
      });
  }

  private buildAssignment(): NewAssignment {
    const role = this.role();
    const kind = this.meta().scopeKind;
    const names = this.schemeIds().map((id) => this.scope.findScheme(id)?.name ?? id);
    if (kind === 'agency') return { role, agencyId: this.agencyId, schemeIds: [], label: this.session.agency()?.shortName ?? 'Agency' };
    if (kind === 'supplier') return { role, agencyId: this.agencyId, schemeIds: [], label: this.supplier().trim() };
    if (kind === 'unit') {
      const unit = `Unit ${this.unit().trim().replace(/^unit\s*/i, '')}`;
      return { role, agencyId: this.agencyId, schemeIds: this.schemeIds(), unitLabel: unit, label: `${unit}, ${names[0]}` };
    }
    if (this.allSchemes() && role !== 'trustee') return { role, agencyId: this.agencyId, schemeIds: [], label: 'All schemes' };
    return { role, agencyId: this.agencyId, schemeIds: this.schemeIds(), label: names.length <= 3 ? names.join(', ') : `${names.length} schemes` };
  }
}
