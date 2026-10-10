import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CatalogueService } from '../../core/catalogue/catalogue.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, of } from 'rxjs';
import {
  AccessDataSource,
  CUSTOMER_ROLES,
  CustomerRole,
  Feature,
  Identity,
  PERMISSIONS,
  Permission,
  PermissionArea,
  ROLE_LABELS,
  ROLE_META,
  ROLE_PERMISSIONS,
  activeAssignments,
} from '../../domain';
import { SessionService } from '../../core/session/session.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { roleColor } from './access-view';

const AREAS: PermissionArea[] = ['Work', 'Portfolio', 'Finance', 'Maintenance', 'Records', 'Residents', 'Administration'];
const SCOPE_TEXT: Record<string, string> = {
  agency: 'The whole agency',
  schemes: 'All or selected schemes',
  unit: 'One unit',
  supplier: 'Their own company',
};

/**
 * Settings › Roles & permissions. Explains Humo's access model and shows the
 * default permissions of each customer role. Read-only for now: fixed roles
 * first, custom roles later (Enterprise plan).
 */
@Component({
  selector: 'app-roles-page',
  imports: [PageHeader, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './roles-page.html',
  styleUrl: './roles-page.scss',
})
export class RolesPage {
  protected readonly catalogue = inject(CatalogueService);
  protected readonly session = inject(SessionService);
  private readonly people = toSignal(
    inject(AccessDataSource)
      .directory(this.session.organisation()?.id ?? '')
      .pipe(catchError(() => of([] as Identity[]))),
    { initialValue: [] as Identity[] },
  );

  protected readonly roles = CUSTOMER_ROLES;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly roleMeta = ROLE_META;
  protected readonly roleColor = (r: CustomerRole) => roleColor({ role: r });
  protected readonly scopeText = SCOPE_TEXT;

  protected readonly holders = computed(() => {
    const agency = this.session.organisation()?.id;
    const counts = new Map<CustomerRole, number>();
    for (const p of this.people()) {
      for (const r of new Set(activeAssignments(p).filter((m) => m.scope.organisationId === agency).map((m) => m.role as CustomerRole))) {
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    return counts;
  });

  protected readonly matrix = AREAS.map((area) => ({ area, permissions: PERMISSIONS.filter((p) => p.area === area) }));
  protected has(role: CustomerRole, p: Permission): boolean {
    return ROLE_PERMISSIONS[role].includes(p);
  }

  protected readonly plan = computed(() => {
    const sub = this.session.subscription();
    return sub ? this.catalogue.packageName(sub.packageId) : '—';
  });
  protected readonly features = computed(() => this.catalogue.features().filter((f) => !f.baseline).map((f) => ({ id: f.key, label: f.label })));
  protected included(f: Feature): boolean {
    return this.session.hasFeature(f);
  }

  protected readonly chain = [
    { icon: 'person-outline', title: 'Identity', q: 'Who is this?', a: 'One person, one sign-in — proven with a passkey or Humo Mobile.' },
    { icon: 'ribbon-outline', title: 'Role', q: 'Which hat?', a: 'The role they’re working in now. People with several roles switch, not sign out.' },
    { icon: 'key-outline', title: 'Permissions', q: 'What can they do?', a: 'Each role carries a fixed set of permissions (below).' },
    { icon: 'business-outline', title: 'Scope', q: 'Where?', a: 'The assignment: the whole agency, chosen schemes, or one unit.' },
    { icon: 'card-outline', title: 'Entitlements', q: 'Does the plan include it?', a: 'Features follow your agency’s subscription.' },
    { icon: 'navigate-outline', title: 'Context', q: 'What’s in focus?', a: 'The scheme picked in the top bar narrows lists further.' },
    { icon: 'document-lock-outline', title: 'Audit', q: 'What happened?', a: 'Every action is recorded with who, which role, where and how they verified.' },
  ];
}
