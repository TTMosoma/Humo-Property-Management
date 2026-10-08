import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Route, Routes } from '@angular/router';
import { roleGuard } from './core/access/role.guard';
import { signedInGuard, signedOutGuard } from './core/access/signed-in.guard';
import { SessionService } from './core/session/session.service';
import type { BreadcrumbData } from './core/shell/breadcrumbs/breadcrumbs';
import { Shell } from './core/shell/shell';
import { AGENCY_STAFF, EVERYONE, FINANCE_STAFF, Feature, HUMO_ROLES, Role, STAFF_AND_TRUSTEE, Scheme, periodLabel } from './domain';
import type { PlannedMeta } from './features/planned/planned-page';
import { schemeResolver } from './features/schemes/scheme.resolver';

const STAFF = AGENCY_STAFF;
const ADMIN: Role[] = ['agency-admin'];
const ADMIN_FINANCE: Role[] = ['agency-admin', 'finance'];
const ADMIN_PM: Role[] = ['agency-admin', 'portfolio-manager'];
const APPROVERS: Role[] = ['agency-admin', 'portfolio-manager', 'finance', 'trustee'];
const RESIDENT: Role[] = ['owner', 'tenant'];
const OWNER: Role[] = ['owner'];
const SYSADMIN: Role[] = ['system-admin'];
const HUMO: readonly Role[] = HUMO_ROLES;
const HUMO_OPS: Role[] = ['system-admin', 'humo-support', 'humo-account-manager'];
const HUMO_AUDIT: Role[] = ['system-admin', 'humo-support'];
/** Money pages: not for Operations (jobs, not ledgers). */
const MONEY: readonly Role[] = FINANCE_STAFF;
const MONEY_AND_TRUSTEE: Role[] = [...FINANCE_STAFF, 'trustee'];
const GOVERNANCE: { feature: Feature } = { feature: 'governance' };

/**
 * A screen that isn't built yet. Each one declares who may open it and the job it serves,
 * so the whole navigation can be clicked through and reviewed now.
 * As screens are built, `loadComponent` is pointed at the real feature component.
 */
function planned(
  path: string,
  title: string | ((route: ActivatedRouteSnapshot) => string),
  roles: readonly Role[],
  checkpoint: number,
  job: string,
  plannedItems: string[] = [],
  crumb: BreadcrumbData | false = typeof title === 'string' ? title : false,
  extra: Record<string, unknown> = {},
): Route {
  const meta: PlannedMeta = { job, planned: plannedItems, checkpoint };
  return {
    path,
    title,
    loadComponent: () => import('./features/planned/planned-page').then((m) => m.PlannedPage),
    data: { roles, planned: meta, ...(crumb ? { breadcrumb: crumb } : {}), ...extra },
  };
}

const schemeName = (d: Record<string, unknown>) => (d['scheme'] as Scheme | undefined)?.name ?? 'Scheme';

export const routes: Routes = [
  // ---------------- Humo identity: shared by every Humo product ----------------
  {
    path: 'signed-out',
    title: 'Signed out',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./features/access/signed-out-page').then((m) => m.SignedOutPage),
  },

  // ---------------- Humo Contractor (a separate Humo product, prototyped here behind its own shell) ----------------
  {
    path: 'contractor',
    loadComponent: () => import('./features/contractor-portal/contractor-shell').then((m) => m.ContractorShell),
    canActivate: [signedInGuard],
    canActivateChild: [roleGuard],
    data: { section: 'Humo Contractor' },
    children: [
      {
        path: '',
        title: 'Dashboard',
        data: { roles: ['supplier'], view: 'dashboard' },
        loadComponent: () => import('./features/contractor-portal/contractor-home-page').then((m) => m.ContractorHomePage),
      },
      {
        path: 'requests',
        title: 'Quote requests',
        data: { roles: ['supplier'], view: 'requests' },
        loadComponent: () => import('./features/contractor-portal/contractor-home-page').then((m) => m.ContractorHomePage),
      },
      {
        path: 'requests/:id',
        title: 'Quote request',
        data: { roles: ['supplier'] },
        loadComponent: () => import('./features/contractor-portal/contractor-request-page').then((m) => m.ContractorRequestPage),
      },
      {
        path: 'jobs',
        title: 'Jobs',
        data: { roles: ['supplier'], view: 'jobs' },
        loadComponent: () => import('./features/contractor-portal/contractor-home-page').then((m) => m.ContractorHomePage),
      },
      {
        path: 'profile',
        title: 'Profile',
        data: { roles: ['supplier'] },
        loadComponent: () => import('./features/contractor-portal/contractor-profile-page').then((m) => m.ContractorProfilePage),
      },
    ],
  },
  {
    path: '',
    component: Shell,
    canActivate: [signedInGuard],
    canActivateChild: [roleGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: () => inject(SessionService).homeRoute() },

      // ---------------- My work (Attention model) ----------------
      {
        path: 'tasks',
        title: 'Tasks',
        data: { section: 'My work', breadcrumb: 'Tasks', roles: STAFF_AND_TRUSTEE },
        loadComponent: () => import('./features/my-work/tasks-page').then((m) => m.TasksPage),
      },
      {
        path: 'approvals',
        title: 'Approvals',
        data: { section: 'My work', breadcrumb: 'Approvals', roles: APPROVERS },
        loadComponent: () => import('./features/my-work/approvals-page').then((m) => m.ApprovalsPage),
      },
      { path: 'tasks/approvals', redirectTo: 'approvals' },
      {
        path: 'inbox',
        data: { section: 'My work' },
        children: [
          planned('', 'Inbox', STAFF, 3, 'Reply to owners, tenants and trustees without losing track — every message linked to its unit, person and scheme.', [
            'Conversations grouped by person and unit, with the account balance and open jobs alongside',
            'Assign, reply from a template, or turn a message into a job or task',
            'Counts come from the Attention model, like every other queue',
          ]),
        ],
      },
      {
        path: 'dashboard',
        title: 'Dashboard',
        data: { section: 'My work', breadcrumb: 'Dashboard', roles: STAFF_AND_TRUSTEE },
        loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
      },

      // ---------------- Schemes & Portfolio ----------------
      {
        path: 'schemes',
        data: { section: 'Portfolio', breadcrumb: 'Schemes', roles: STAFF_AND_TRUSTEE },
        children: [
          {
            path: '',
            title: 'Schemes',
            data: { roles: STAFF },
            loadComponent: () => import('./features/schemes/schemes-page').then((m) => m.SchemesPage),
          },
          {
            path: ':schemeId',
            resolve: { scheme: schemeResolver },
            data: { breadcrumb: schemeName },
            loadComponent: () => import('./features/schemes/scheme-workspace').then((m) => m.SchemeWorkspace),
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'overview' },
              {
                path: 'overview',
                title: 'Overview',
                data: { breadcrumb: 'Overview' },
                loadComponent: () => import('./features/schemes/scheme-overview').then((m) => m.SchemeOverview),
              },
              {
                path: 'units',
                title: 'Units',
                data: { roles: STAFF, breadcrumb: 'Units' },
                loadComponent: () => import('./features/units/units-page').then((m) => m.UnitsPage),
              },
              {
                // A unit and its account are records in their own right: the workspace hides
                // its header and tabs (data.record) and the unit's own header takes over.
                path: 'units/:unitId',
                data: { roles: STAFF, record: true, breadcrumb: (_: unknown, p: Record<string, string>) => `Unit ${p['unitId']}` },
                children: [
                  {
                    path: '',
                    title: (r: ActivatedRouteSnapshot) => `Unit ${r.paramMap.get('unitId')}`,
                    loadComponent: () => import('./features/units/unit-page').then((m) => m.UnitPage),
                  },
                  {
                    path: 'account',
                    data: { breadcrumb: 'Account', roles: MONEY },
                    children: [
                      {
                        path: '',
                        title: 'Account',
                        loadComponent: () => import('./features/accounts/account-page').then((m) => m.AccountPage),
                      },
                      {
                        path: 'statements/:period',
                        title: (r: ActivatedRouteSnapshot) => `${periodLabel(r.paramMap.get('period')!)} statement`,
                        data: { breadcrumb: (_: unknown, p: Record<string, string>) => periodLabel(p['period']) },
                        loadComponent: () => import('./features/accounts/statement-page').then((m) => m.StatementPage),
                      },
                    ],
                  },
                ],
              },
              {
                path: 'people',
                title: 'People',
                data: { roles: STAFF, breadcrumb: 'People' },
                loadComponent: () => import('./features/people/people-page').then((m) => m.PeoplePage),
              },
              planned('finance', 'Finance', MONEY_AND_TRUSTEE, 3, 'This scheme’s levy roll, receipts, credit control, payables and budget.'),
              {
                path: 'maintenance',
                title: 'Maintenance',
                data: { roles: STAFF_AND_TRUSTEE, breadcrumb: 'Maintenance' },
                loadComponent: () => import('./features/maintenance/jobs-page').then((m) => m.JobsPage),
              },
              {
                path: 'suppliers',
                title: 'Suppliers',
                data: { roles: STAFF_AND_TRUSTEE, breadcrumb: 'Suppliers' },
                loadComponent: () => import('./features/suppliers/suppliers-page').then((m) => m.SuppliersPage),
              },
              planned('documents', 'Documents', STAFF_AND_TRUSTEE, 7, 'This scheme’s documents, filtered from the library.'),
              planned('communications', 'Communications', MONEY, 6, 'Everything sent to and received from this scheme’s people.'),
              planned('meetings', 'Meetings', STAFF_AND_TRUSTEE, 5, 'Trustee meetings, AGMs and SGMs, with resolutions and actions.', [], 'Meetings', GOVERNANCE),
              planned('compliance', 'Compliance', STAFF_AND_TRUSTEE, 7, 'This scheme’s compliance items, generated from its records.'),
              planned('reports', 'Reports', STAFF_AND_TRUSTEE, 8, 'Reports scoped to this scheme.'),
            ],
          },
        ],
      },
      {
        path: 'units',
        data: { section: 'Portfolio' },
        children: [
          {
            path: '',
            title: 'Units',
            data: { roles: STAFF, breadcrumb: 'Units' },
            loadComponent: () => import('./features/units/units-page').then((m) => m.UnitsPage),
          },
        ],
      },
      {
        path: 'people',
        data: { section: 'Portfolio', breadcrumb: 'People' },
        children: [
          {
            path: '',
            title: 'People',
            data: { roles: STAFF },
            loadComponent: () => import('./features/people/people-page').then((m) => m.PeoplePage),
          },
          planned('new', 'Add person', ADMIN_PM, 3, 'Add an owner, tenant or trustee and link them to units.'),
          {
            path: ':personId',
            title: 'Person',
            data: { roles: STAFF, breadcrumb: 'Person' },
            loadComponent: () => import('./features/people/person-page').then((m) => m.PersonPage),
          },
        ],
      },
      {
        path: 'staff',
        data: { section: 'Portfolio', breadcrumb: 'Staff' },
        children: [
          planned('', 'Staff', STAFF, 3, 'See who manages what, and each person’s workload.', [
            'Team list with role, assigned schemes, open tasks and overdue work (from the Attention model)',
            'Reassign schemes and work when someone is away',
          ], false),
          planned(':staffId', 'Staff member', STAFF, 3, 'One team member’s schemes, tasks and activity.'),
        ],
      },

      // ---------------- Finance ----------------
      {
        path: 'finance',
        data: { section: 'Finance' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'billing' },
          planned('billing', 'Levies & billing', MONEY, 6, 'Bill every unit correctly each month.', [
            'Levy schedules per scheme (participation quota, special levies)',
            'Billing runs with status; statements are generated and sent from the run',
          ]),
          planned('billing/new', 'New billing run', ADMIN_FINANCE, 6, 'Run monthly billing safely.', [
            'Scope → Period → Charges preview → Exceptions → Approval (Approvals) → Generate & send statements',
            'Posted runs are locked; corrections are journal adjustments',
          ]),
          {
            path: 'receipts',
            title: 'Receipts',
            data: { roles: ADMIN_FINANCE, breadcrumb: 'Receipts', feature: 'payment-allocation' },
            loadComponent: () => import('./features/receipts/receipts-page').then((m) => m.ReceiptsPage),
          },
          planned('credit-control', 'Credit control', MONEY, 6, 'Chase arrears in a structured, fair way.', [
            'Collection pipeline: Reminder → Final demand → Letter of demand → Handed over (+ Arrangement, Disputed)',
            'Ageing (Current · 30 · 60 · 90 · 120+) as a filter and chart',
            'Bulk reminders through Compose',
          ]),
          {
            path: 'payables',
            title: 'Payables',
            data: { roles: MONEY_AND_TRUSTEE, breadcrumb: 'Payables', feature: 'payables' },
            loadComponent: () => import('./features/finance/payables-page').then((m) => m.PayablesPage),
          },
          planned('budgets', 'Budgets', MONEY_AND_TRUSTEE, 5, 'Prepare budgets and track budget vs actual.', [
            'Budget vs Actual vs Variance by category with visual comparison',
            'Budget approval at the AGM links to Meetings',
          ]),
          { path: 'debtors', redirectTo: 'credit-control' },
          { path: 'supplier-invoices', redirectTo: 'payables' },
          { path: 'reports', redirectTo: '/reports' },
        ],
      },

      // ---------------- Maintenance & Suppliers ----------------
      {
        path: 'maintenance',
        data: { section: 'Maintenance', breadcrumb: 'Jobs' },
        children: [
          {
            path: '',
            title: 'Jobs',
            data: { roles: STAFF_AND_TRUSTEE },
            loadComponent: () => import('./features/maintenance/jobs-page').then((m) => m.JobsPage),
          },
          {
            path: 'new',
            title: 'Log request',
            data: { roles: STAFF, breadcrumb: 'Log request', mode: 'staff' },
            loadComponent: () => import('./features/maintenance/request-form').then((m) => m.RequestForm),
          },
          { path: 'quotes', redirectTo: '/approvals' },
          {
            path: ':requestId/quote-request',
            title: 'Request quotes',
            data: { roles: STAFF, breadcrumb: 'Request quotes' },
            loadComponent: () => import('./features/maintenance/quotes/quote-request-page').then((m) => m.QuoteRequestPage),
          },
          {
            path: ':requestId/quotes',
            title: 'Compare quotes',
            data: { roles: STAFF_AND_TRUSTEE, breadcrumb: 'Compare quotes' },
            loadComponent: () => import('./features/maintenance/quotes/quote-compare-page').then((m) => m.QuoteComparePage),
          },
          {
            path: ':requestId',
            title: (r: ActivatedRouteSnapshot) => `Job ${r.paramMap.get('requestId')}`,
            data: { roles: STAFF_AND_TRUSTEE, breadcrumb: (_: unknown, p: Record<string, string>) => p['requestId'] },
            loadComponent: () => import('./features/maintenance/job-page').then((m) => m.JobPage),
          },
        ],
      },
      {
        path: 'suppliers',
        data: { section: 'Maintenance', breadcrumb: 'Suppliers' },
        children: [
          {
            path: '',
            title: 'Suppliers',
            data: { roles: STAFF_AND_TRUSTEE },
            loadComponent: () => import('./features/suppliers/suppliers-page').then((m) => m.SuppliersPage),
          },
          {
            path: ':supplierId',
            title: 'Supplier',
            data: { roles: STAFF_AND_TRUSTEE, breadcrumb: 'Supplier' },
            loadComponent: () => import('./features/suppliers/supplier-page').then((m) => m.SupplierPage),
          },
        ],
      },

      // ---------------- Communications & Documents ----------------
      {
        path: 'communications',
        data: { section: 'Communications' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'sent' },
          planned('sent', 'Sent', STAFF_AND_TRUSTEE, 6, 'Prove what was sent, to whom, when — and whether it arrived.'),
          planned('compose', 'Compose', STAFF, 6, 'Send to a scheme, units or people from a template, by email, SMS, WhatsApp or portal notice.'),
          planned('templates', 'Templates', STAFF, 6, 'Reusable messages: levy reminders, AGM notices, water outages.'),
          { path: 'announcements', redirectTo: 'sent' },
          { path: 'history', redirectTo: 'sent' },
        ],
      },
      {
        path: 'documents',
        data: { section: 'Documents' },
        children: [
          planned('', 'Documents', STAFF_AND_TRUSTEE, 7, 'Quickly find the right document for the right scheme.', [
            'A search over every attachment in Humo Property Management, with facets: scheme, category, date, related record, uploader',
            'Visibility per document (staff · trustees · owners · one unit) and expiry dates that feed Compliance',
          ], false),
        ],
      },

      // ---------------- Governance & Compliance ----------------
      {
        path: 'governance',
        data: { section: 'Governance', feature: 'governance' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'meetings' },
          planned('meetings', 'Meetings', STAFF_AND_TRUSTEE, 5, 'Prepare, run and minute meetings, including AGMs and SGMs.', [
            'Lifecycle: Draft agenda → Notice sent → Pack ready → Held → Minutes draft → Minutes approved',
          ]),
          planned('meetings/new', 'Schedule meeting', ADMIN_PM, 5, 'Schedule a trustee meeting, AGM or SGM.'),
          planned('meetings/:meetingId', 'Meeting', STAFF_AND_TRUSTEE, 5, 'Agenda, attendees, documents, decisions, action items and minutes.'),
          planned('resolutions', 'Resolutions & actions', STAFF_AND_TRUSTEE, 5, 'Track what was decided and whether it was done.', [
            'Resolution → Meeting → Decision → Action (a Task) → Assigned person → Completion',
          ]),
          planned('trustees', 'Trustee boards', STAFF_AND_TRUSTEE, 5, 'Who serves on each board, in which role, and since when.'),
          planned('rules', 'Scheme rules', STAFF_AND_TRUSTEE, 5, 'Keep rules current and support their enforcement.'),
        ],
      },
      {
        path: 'compliance',
        data: { section: 'Compliance', feature: 'compliance' },
        children: [
          planned('', 'Compliance', STAFF_AND_TRUSTEE, 7, 'Know what is due, overdue or complete across every scheme.', [
            'Matrix: schemes × compliance types, cells drill into the source record',
            'Items generated from insurance documents, AGM dates, supplier documents and financial year-ends',
            'Statuses: Complete · Due soon · Overdue · Not applicable (no regulatory logic yet)',
          ], false),
          planned(':itemId', 'Compliance item', STAFF_AND_TRUSTEE, 7, 'One compliance item, its evidence and history.'),
        ],
      },

      // ---------------- Reports ----------------
      {
        path: 'reports',
        data: { section: 'Reports' },
        children: [
          planned('', 'Reports', STAFF_AND_TRUSTEE, 8, 'One catalogue of portfolio and scheme reports, including financial reports.', [], false),
          planned(':reportId', 'Report', STAFF_AND_TRUSTEE, 8, 'View, filter and export one report.'),
        ],
      },

      // ---------------- Settings ----------------
      {
        path: 'settings',
        data: { section: 'Settings' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'profile' },
          planned('profile', 'My profile', EVERYONE, 8, 'Your details and personal notification preferences.'),
          {
            path: 'security',
            title: 'Security',
            data: { roles: EVERYONE, breadcrumb: 'Security' },
            loadComponent: () => import('./features/security/security-page').then((m) => m.SecurityPage),
          },
          planned('agency', 'Agency', ADMIN, 8, 'Agency details, branding, trust bank accounts and banking details shown on statements.'),
          {
            path: 'users',
            title: 'Users & access',
            data: { roles: ADMIN, breadcrumb: 'Users & access' },
            loadComponent: () => import('./features/access/users-page').then((m) => m.UsersPage),
          },
          {
            path: 'plan',
            title: 'Plan & features',
            // Staff can read it (nudges link here); only administrators can ask Humo for more.
            data: { roles: STAFF, breadcrumb: 'Plan & features' },
            loadComponent: () => import('./features/plan/plan-page').then((m) => m.PlanPage),
          },
          {
            path: 'roles',
            title: 'Roles & permissions',
            data: { roles: ADMIN, breadcrumb: 'Roles & permissions' },
            loadComponent: () => import('./features/access/roles-page').then((m) => m.RolesPage),
          },
          {
            path: 'audit',
            title: 'Audit log',
            data: { roles: ADMIN, breadcrumb: 'Audit log', feature: 'audit-log' },
            loadComponent: () => import('./features/audit/audit-page').then((m) => m.AuditPage),
          },
          planned('notifications', 'Notifications', ADMIN_PM, 8, 'Agency-wide notification rules and channels.'),
          planned('billing', 'Billing configuration', ADMIN_FINANCE, 8, 'Interest rates, billing day, statement layout and levy rules.'),
          planned('system', 'System', SYSADMIN, 8, 'Platform-wide configuration.'),
        ],
      },

      // ---------------- Resident portal ----------------
      {
        path: 'my',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'home' },
          {
            path: 'home',
            title: 'Home',
            data: { roles: RESIDENT },
            loadComponent: () => import('./features/my/resident-home-page').then((m) => m.ResidentHomePage),
          },
          {
            path: 'account',
            title: 'My account',
            data: { roles: OWNER },
            loadComponent: () => import('./features/my/owner-account-page').then((m) => m.OwnerAccountPage),
          },
          {
            path: 'statements/:period',
            title: 'Statement',
            data: { roles: OWNER },
            loadComponent: () => import('./features/accounts/statement-page').then((m) => m.StatementPage),
          },
          {
            path: 'requests',
            title: 'My requests',
            data: { roles: RESIDENT },
            loadComponent: () => import('./features/my/my-requests-page').then((m) => m.MyRequestsPage),
          },
          {
            path: 'requests/new',
            title: 'Report a problem',
            data: { roles: RESIDENT, mode: 'resident' },
            loadComponent: () => import('./features/maintenance/request-form').then((m) => m.RequestForm),
          },
          planned('documents', 'Documents', RESIDENT, 8, 'Rules, minutes and my own documents.'),
          planned('notices', 'Notices', RESIDENT, 8, 'Announcements from the managing agent and trustees.'),
          { path: 'statements', pathMatch: 'full', redirectTo: 'account' },
        ],
      },

      // Humo Contractor lives outside the PM shell (see the 'contractor' route above).
      { path: 'supplier', redirectTo: '/contractor' },

      // ---------------- Platform (Humo internal roles) ----------------
      {
        path: 'platform',
        data: { section: 'Platform' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'customers' },
          { path: 'agencies', redirectTo: 'customers' },
          {
            path: 'executive',
            data: { breadcrumb: 'Business overview' },
            children: [
              {
                path: '',
                title: 'Business overview',
                data: { roles: ['humo-executive', 'system-admin'] },
                loadComponent: () => import('./features/platform/executive-page').then((m) => m.ExecutivePage),
              },
              {
                // Focused views of the same dashboard: revenue, growth, health, opportunities.
                path: ':section',
                title: 'Business overview',
                data: { roles: ['humo-executive', 'system-admin'], breadcrumb: (_: unknown, p: Record<string, string>) => p['section'].replace(/^./, (c) => c.toUpperCase()) },
                loadComponent: () => import('./features/platform/executive-page').then((m) => m.ExecutivePage),
              },
            ],
          },
          {
            path: 'accounts',
            data: { breadcrumb: 'My accounts' },
            children: [
              {
                path: '',
                title: 'My accounts',
                data: { roles: ['humo-account-manager'] },
                loadComponent: () => import('./features/platform/accounts-page').then((m) => m.AccountsPage),
              },
              {
                path: ':view',
                title: 'My accounts',
                data: { roles: ['humo-account-manager'], breadcrumb: (_: unknown, p: Record<string, string>) => ({ health: 'Account health', subscriptions: 'Subscriptions', opportunities: 'Opportunities', support: 'Support & requests' })[p['view']] ?? p['view'] },
                loadComponent: () => import('./features/platform/accounts-page').then((m) => m.AccountsPage),
              },
            ],
          },
          {
            path: 'customers',
            data: { breadcrumb: 'Customers' },
            children: [
              {
                path: '',
                title: 'Customers',
                data: { roles: HUMO },
                loadComponent: () => import('./features/platform/customers-page').then((m) => m.CustomersPage),
              },
              {
                path: ':organisationId',
                title: 'Customer',
                data: { roles: HUMO, breadcrumb: (_: unknown, p: Record<string, string>) => p['organisationId'] },
                loadComponent: () => import('./features/platform/customer-page').then((m) => m.CustomerPage),
              },
            ],
          },
          {
            path: 'packages',
            title: 'Packages & features',
            data: { roles: ['system-admin', 'humo-account-manager', 'humo-executive'], breadcrumb: 'Packages & features' },
            loadComponent: () => import('./features/platform/packages-page').then((m) => m.PackagesPage),
          },
          planned('flags', 'Feature flags', SYSADMIN, 9, 'Roll features out safely: per environment, per customer, per percentage — separate from commercial entitlements.', [
            'Flags are technical (is it switched on?); entitlements are commercial (has the customer got it?)',
            'Kill switches and gradual rollout, every change audited',
          ]),
          {
            path: 'users',
            title: 'Users & impersonation',
            data: { roles: HUMO_OPS, breadcrumb: 'Users & impersonation' },
            loadComponent: () => import('./features/platform/platform-users-page').then((m) => m.PlatformUsersPage),
          },
          {
            path: 'audit',
            title: 'Platform audit log',
            data: { roles: HUMO_AUDIT, breadcrumb: 'Audit log', platform: true },
            loadComponent: () => import('./features/audit/audit-page').then((m) => m.AuditPage),
          },
          { path: 'plans', redirectTo: 'packages' },
          planned('health', 'Platform health', ['system-admin', 'humo-support'], 9, 'Uptime, background jobs, integrations and error rates.'),
        ],
      },

      // ---------------- System pages ----------------
      {
        path: 'no-access',
        title: 'No access',
        loadComponent: () => import('./features/access/no-access-page').then((m) => m.NoAccessPage),
      },
      {
        path: 'not-found',
        title: 'Not found',
        loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
      },
      {
        path: '**',
        title: 'Page not found',
        loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
