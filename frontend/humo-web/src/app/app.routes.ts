import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Route, Router, Routes } from '@angular/router';
import { accessGuard } from './core/access/access.guard';
import { signedInGuard, signedOutGuard } from './core/access/signed-in.guard';
import { SessionService } from './core/session/session.service';
import type { BreadcrumbData } from './core/shell/breadcrumbs/breadcrumbs';
import { Shell } from './core/shell/shell';
import { Feature, Permission, Scheme, periodLabel } from './domain';
import type { PlannedMeta } from './features/planned/planned-page';
import { schemeResolver } from './features/schemes/scheme.resolver';

const GOVERNANCE: { feature: Feature } = { feature: 'governance' };

/**
 * A screen that isn't built yet. Each one declares the permission needed to open it and the job it serves,
 * so the whole navigation can be clicked through and reviewed now.
 * As screens are built, `loadComponent` is pointed at the real feature component.
 */
function planned(
  path: string,
  title: string | ((route: ActivatedRouteSnapshot) => string),
  permission: Permission,
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
    data: { permission, planned: meta, ...(crumb ? { breadcrumb: crumb } : {}), ...extra },
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
    canActivateChild: [accessGuard],
    data: { section: 'Humo Contractor' },
    children: [
      {
        path: '',
        title: 'Dashboard',
        data: { permission: 'Contractor.Respond', view: 'dashboard' },
        loadComponent: () => import('./features/contractor-portal/contractor-home-page').then((m) => m.ContractorHomePage),
      },
      {
        path: 'requests',
        title: 'Quote requests',
        data: { permission: 'Contractor.Respond', view: 'requests' },
        loadComponent: () => import('./features/contractor-portal/contractor-home-page').then((m) => m.ContractorHomePage),
      },
      {
        path: 'requests/:id',
        title: 'Quote request',
        data: { permission: 'Contractor.Respond' },
        loadComponent: () => import('./features/contractor-portal/contractor-request-page').then((m) => m.ContractorRequestPage),
      },
      {
        path: 'jobs',
        title: 'Jobs',
        data: { permission: 'Contractor.Respond', view: 'jobs' },
        loadComponent: () => import('./features/contractor-portal/contractor-home-page').then((m) => m.ContractorHomePage),
      },
      {
        path: 'profile',
        title: 'Profile',
        data: { permission: 'Contractor.Respond' },
        loadComponent: () => import('./features/contractor-portal/contractor-profile-page').then((m) => m.ContractorProfilePage),
      },
    ],
  },
  {
    path: '',
    component: Shell,
    canActivate: [signedInGuard],
    canActivateChild: [accessGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: () => inject(SessionService).homeRoute() },

      // ---------------- My work (Attention model) ----------------
      {
        path: 'tasks',
        title: 'Tasks',
        data: { section: 'My work', breadcrumb: 'Tasks', permission: 'Work.View' },
        loadComponent: () => import('./features/my-work/tasks-page').then((m) => m.TasksPage),
      },
      {
        path: 'approvals',
        title: 'Approvals',
        data: { section: 'My work', breadcrumb: 'Approvals', permission: 'Approvals.Decide' },
        loadComponent: () => import('./features/my-work/approvals-page').then((m) => m.ApprovalsPage),
      },
      { path: 'tasks/approvals', redirectTo: 'approvals' },
      {
        path: 'inbox',
        data: { section: 'My work' },
        children: [
          planned('', 'Inbox', 'Messages.Reply', 3, 'Reply to owners, tenants and trustees without losing track — every message linked to its unit, person and scheme.', [
            'Conversations grouped by person and unit, with the account balance and open jobs alongside',
            'Assign, reply from a template, or turn a message into a job or task',
            'Counts come from the Attention model, like every other queue',
          ]),
        ],
      },
      {
        path: 'dashboard',
        title: 'Dashboard',
        data: { section: 'My work', breadcrumb: 'Dashboard', permission: 'Work.View' },
        loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
      },

      // ---------------- Schemes & Portfolio ----------------
      {
        path: 'schemes',
        data: { section: 'Portfolio', breadcrumb: 'Schemes', permission: 'Portfolio.View' },
        children: [
          {
            path: '',
            title: 'Schemes',
            data: { permission: 'Portfolio.Browse' },
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
                data: { permission: 'Portfolio.Browse', breadcrumb: 'Units' },
                loadComponent: () => import('./features/units/units-page').then((m) => m.UnitsPage),
              },
              {
                // A unit and its account are records in their own right: the workspace hides
                // its header and tabs (data.record) and the unit's own header takes over.
                path: 'units/:unitId',
                data: { permission: 'Portfolio.Browse', record: true, breadcrumb: (_: unknown, p: Record<string, string>) => `Unit ${p['unitId']}` },
                children: [
                  {
                    path: '',
                    title: (r: ActivatedRouteSnapshot) => `Unit ${r.paramMap.get('unitId')}`,
                    loadComponent: () => import('./features/units/unit-page').then((m) => m.UnitPage),
                  },
                  {
                    path: 'account',
                    data: { breadcrumb: 'Account', permission: 'Accounts.View' },
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
                data: { permission: 'Portfolio.Browse', breadcrumb: 'People' },
                loadComponent: () => import('./features/people/people-page').then((m) => m.PeoplePage),
              },
              planned('finance', 'Finance', 'Finance.View', 3, 'This scheme’s levy roll, receipts, credit control, payables and budget.'),
              {
                path: 'maintenance',
                title: 'Maintenance',
                data: { permission: 'Maintenance.View', breadcrumb: 'Maintenance' },
                loadComponent: () => import('./features/maintenance/jobs-page').then((m) => m.JobsPage),
              },
              {
                path: 'suppliers',
                title: 'Suppliers',
                data: { permission: 'Suppliers.View', breadcrumb: 'Suppliers' },
                loadComponent: () => import('./features/suppliers/suppliers-page').then((m) => m.SuppliersPage),
              },
              planned('documents', 'Documents', 'Documents.View', 7, 'This scheme’s documents, filtered from the library.'),
              planned('communications', 'Communications', 'Communications.View', 6, 'Everything sent to and received from this scheme’s people.'),
              {
                path: 'meetings',
                title: 'Meetings',
                data: { permission: 'Governance.View', breadcrumb: 'Meetings', ...GOVERNANCE },
                loadComponent: () => import('./features/governance/meetings-page').then((m) => m.MeetingsPage),
              },
              planned('compliance', 'Compliance', 'Compliance.View', 7, 'This scheme’s compliance items, generated from its records.'),
              planned('reports', 'Reports', 'Reports.View', 8, 'Reports scoped to this scheme.'),
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
            data: { permission: 'Portfolio.Browse', breadcrumb: 'Units' },
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
            data: { permission: 'Portfolio.Browse' },
            loadComponent: () => import('./features/people/people-page').then((m) => m.PeoplePage),
          },
          { path: 'new', redirectTo: () => inject(Router).parseUrl('/people?new=1') },
          {
            path: ':personId',
            title: 'Person',
            data: { permission: 'Portfolio.Browse', breadcrumb: 'Person' },
            loadComponent: () => import('./features/people/person-page').then((m) => m.PersonPage),
          },
        ],
      },
      {
        path: 'staff',
        data: { section: 'Portfolio', breadcrumb: 'Staff' },
        children: [
          planned('', 'Staff', 'Portfolio.Browse', 3, 'See who manages what, and each person’s workload.', [
            'Team list with role, assigned schemes, open tasks and overdue work (from the Attention model)',
            'Reassign schemes and work when someone is away',
          ], false),
          planned(':staffId', 'Staff member', 'Portfolio.Browse', 3, 'One team member’s schemes, tasks and activity.'),
        ],
      },

      // ---------------- Finance ----------------
      {
        path: 'finance',
        data: { section: 'Finance' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'billing' },
          {
            path: 'billing',
            data: { permission: 'Billing.View', breadcrumb: 'Levies & billing', feature: 'billing' },
            children: [
              { path: '', title: 'Levies & billing', loadComponent: () => import('./features/finance/billing/billing-page').then((m) => m.BillingPage) },
              { path: 'new', redirectTo: () => inject(Router).parseUrl('/finance/billing?new=1') },
              {
                path: ':runId',
                title: 'Billing run',
                data: { breadcrumb: 'Billing run' },
                loadComponent: () => import('./features/finance/billing/billing-run-page').then((m) => m.BillingRunPage),
              },
            ],
          },
          {
            path: 'receipts',
            title: 'Receipts',
            data: { permission: 'Receipts.Allocate', breadcrumb: 'Receipts', feature: 'payment-allocation' },
            loadComponent: () => import('./features/receipts/receipts-page').then((m) => m.ReceiptsPage),
          },
          {
            path: 'credit-control',
            data: { permission: 'Billing.View', breadcrumb: 'Credit control', feature: 'credit-control' },
            children: [
              { path: '', title: 'Credit control', loadComponent: () => import('./features/finance/credit-control/credit-control-page').then((m) => m.CreditControlPage) },
              {
                path: ':accountId',
                data: { breadcrumb: 'Collection' },
                children: [
                  { path: '', title: 'Collection', loadComponent: () => import('./features/finance/credit-control/collection-page').then((m) => m.CollectionPage) },
                  {
                    path: 'letters/:stepId',
                    title: 'Collection letter',
                    data: { breadcrumb: 'Letter' },
                    loadComponent: () => import('./features/finance/credit-control/collection-letter-page').then((m) => m.CollectionLetterPage),
                  },
                ],
              },
            ],
          },
          {
            path: 'payables',
            title: 'Payables',
            data: { permission: 'Finance.View', breadcrumb: 'Payables', feature: 'payables' },
            loadComponent: () => import('./features/finance/payables-page').then((m) => m.PayablesPage),
          },
          planned('budgets', 'Budgets', 'Finance.View', 5, 'Prepare budgets and track budget vs actual.', [
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
            data: { permission: 'Maintenance.View' },
            loadComponent: () => import('./features/maintenance/jobs-page').then((m) => m.JobsPage),
          },
          {
            path: 'new',
            title: 'Log request',
            data: { permission: 'Maintenance.Log', breadcrumb: 'Log request', mode: 'staff' },
            loadComponent: () => import('./features/maintenance/request-form').then((m) => m.RequestForm),
          },
          { path: 'quotes', redirectTo: '/approvals' },
          {
            path: ':requestId/quote-request',
            title: 'Request quotes',
            data: { permission: 'Maintenance.Manage', breadcrumb: 'Request quotes' },
            loadComponent: () => import('./features/maintenance/quotes/quote-request-page').then((m) => m.QuoteRequestPage),
          },
          {
            path: ':requestId/quotes',
            title: 'Compare quotes',
            data: { permission: 'Maintenance.View', breadcrumb: 'Compare quotes' },
            loadComponent: () => import('./features/maintenance/quotes/quote-compare-page').then((m) => m.QuoteComparePage),
          },
          {
            path: ':requestId',
            title: (r: ActivatedRouteSnapshot) => `Job ${r.paramMap.get('requestId')}`,
            data: { permission: 'Maintenance.View', breadcrumb: (_: unknown, p: Record<string, string>) => p['requestId'] },
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
            data: { permission: 'Suppliers.View' },
            loadComponent: () => import('./features/suppliers/suppliers-page').then((m) => m.SuppliersPage),
          },
          {
            path: ':supplierId',
            title: 'Supplier',
            data: { permission: 'Suppliers.View', breadcrumb: 'Supplier' },
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
          planned('sent', 'Sent', 'Communications.View', 6, 'Prove what was sent, to whom, when — and whether it arrived.'),
          planned('compose', 'Compose', 'Messages.Reply', 6, 'Send to a scheme, units or people from a template, by email, SMS, WhatsApp or portal notice.'),
          planned('templates', 'Templates', 'Messages.Reply', 6, 'Reusable messages: levy reminders, AGM notices, water outages.'),
          { path: 'announcements', redirectTo: 'sent' },
          { path: 'history', redirectTo: 'sent' },
        ],
      },
      {
        path: 'documents',
        data: { section: 'Documents' },
        children: [
          planned('', 'Documents', 'Documents.View', 7, 'Quickly find the right document for the right scheme.', [
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
          {
            path: 'meetings',
            data: { permission: 'Governance.View', breadcrumb: 'Meetings' },
            children: [
              { path: '', title: 'Meetings', loadComponent: () => import('./features/governance/meetings-page').then((m) => m.MeetingsPage) },
              { path: 'new', redirectTo: () => inject(Router).parseUrl('/governance/meetings?new=1') },
              {
                path: ':meetingId',
                data: { breadcrumb: 'Meeting' },
                children: [
                  { path: '', title: 'Meeting', loadComponent: () => import('./features/governance/meeting-page').then((m) => m.MeetingPage) },
                  {
                    path: 'notice',
                    title: 'Notice of meeting',
                    data: { breadcrumb: 'Notice', document: 'meeting-notice' },
                    loadComponent: () => import('./features/governance/meeting-document-page').then((m) => m.MeetingDocumentPage),
                  },
                  {
                    path: 'minutes',
                    title: 'Minutes',
                    data: { breadcrumb: 'Minutes', document: 'meeting-minutes' },
                    loadComponent: () => import('./features/governance/meeting-document-page').then((m) => m.MeetingDocumentPage),
                  },
                ],
              },
            ],
          },
          {
            path: 'resolutions',
            title: 'Resolutions & actions',
            data: { permission: 'Governance.View', breadcrumb: 'Resolutions & actions' },
            loadComponent: () => import('./features/governance/resolutions-page').then((m) => m.ResolutionsPage),
          },
          planned('trustees', 'Trustee boards', 'Governance.View', 5, 'Who serves on each board, in which role, and since when.'),
          planned('rules', 'Scheme rules', 'Governance.View', 5, 'Keep rules current and support their enforcement.'),
        ],
      },
      {
        path: 'compliance',
        data: { section: 'Compliance', feature: 'compliance' },
        children: [
          planned('', 'Compliance', 'Compliance.View', 7, 'Know what is due, overdue or complete across every scheme.', [
            'Matrix: schemes × compliance types, cells drill into the source record',
            'Items generated from insurance documents, AGM dates, supplier documents and financial year-ends',
            'Statuses: Complete · Due soon · Overdue · Not applicable (no regulatory logic yet)',
          ], false),
          planned(':itemId', 'Compliance item', 'Compliance.View', 7, 'One compliance item, its evidence and history.'),
        ],
      },

      // ---------------- Reports ----------------
      {
        path: 'reports',
        data: { section: 'Reports' },
        children: [
          planned('', 'Reports', 'Reports.View', 8, 'One catalogue of portfolio and scheme reports, including financial reports.', [], false),
          planned(':reportId', 'Report', 'Reports.View', 8, 'View, filter and export one report.'),
        ],
      },

      // ---------------- Settings ----------------
      {
        path: 'settings',
        data: { section: 'Settings' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'profile' },
          planned('profile', 'My profile', 'Security.ManageOwn', 8, 'Your details and personal notification preferences.'),
          {
            path: 'security',
            title: 'Security',
            data: { permission: 'Security.ManageOwn', breadcrumb: 'Security' },
            loadComponent: () => import('./features/security/security-page').then((m) => m.SecurityPage),
          },
          planned('agency', 'Agency', 'Organisation.Manage', 8, 'Agency details, branding, trust bank accounts and banking details shown on statements.'),
          {
            path: 'users',
            title: 'Users & access',
            data: { permission: 'Users.Manage', breadcrumb: 'Users & access' },
            loadComponent: () => import('./features/access/users-page').then((m) => m.UsersPage),
          },
          {
            path: 'documents',
            title: 'Documents & templates',
            data: { permission: 'Documents.Configure', breadcrumb: 'Documents & templates' },
            loadComponent: () => import('./features/documents/documents-settings-page').then((m) => m.DocumentsSettingsPage),
          },
          {
            path: 'plan',
            title: 'Plan & features',
            // Staff can read it (nudges link here); only administrators can ask Humo for more.
            data: { permission: 'Subscription.View', breadcrumb: 'Plan & features' },
            loadComponent: () => import('./features/plan/plan-page').then((m) => m.PlanPage),
          },
          {
            path: 'roles',
            title: 'Roles & permissions',
            data: { permission: 'Users.Manage', breadcrumb: 'Roles & permissions' },
            loadComponent: () => import('./features/access/roles-page').then((m) => m.RolesPage),
          },
          {
            path: 'audit',
            title: 'Audit log',
            data: { permission: 'Audit.View', breadcrumb: 'Audit log', feature: 'audit-log' },
            loadComponent: () => import('./features/audit/audit-page').then((m) => m.AuditPage),
          },
          planned('notifications', 'Notifications', 'Notifications.Configure', 8, 'Agency-wide notification rules and channels.'),
          planned('billing', 'Billing configuration', 'Billing.Run', 8, 'Interest rates, billing day, statement layout and levy rules.'),
          planned('system', 'System', 'Platform.Config.Manage', 8, 'Platform-wide configuration.'),
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
            data: { permission: 'Resident.Portal' },
            loadComponent: () => import('./features/my/resident-home-page').then((m) => m.ResidentHomePage),
          },
          {
            path: 'account',
            title: 'My account',
            data: { permission: 'Account.ViewOwn' },
            loadComponent: () => import('./features/my/owner-account-page').then((m) => m.OwnerAccountPage),
          },
          {
            path: 'statements/:period',
            title: 'Statement',
            data: { permission: 'Account.ViewOwn' },
            loadComponent: () => import('./features/accounts/statement-page').then((m) => m.StatementPage),
          },
          {
            path: 'requests',
            title: 'My requests',
            data: { permission: 'Resident.Portal' },
            loadComponent: () => import('./features/my/my-requests-page').then((m) => m.MyRequestsPage),
          },
          {
            path: 'requests/new',
            title: 'Report a problem',
            data: { permission: 'Resident.Requests', mode: 'resident' },
            loadComponent: () => import('./features/maintenance/request-form').then((m) => m.RequestForm),
          },
          planned('documents', 'Documents', 'Resident.Portal', 8, 'Rules, minutes and my own documents.'),
          planned('notices', 'Notices', 'Resident.Portal', 8, 'Announcements from the managing agent and trustees.'),
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
                data: { permission: 'Platform.Insights.View' },
                loadComponent: () => import('./features/platform/executive-page').then((m) => m.ExecutivePage),
              },
              {
                // Focused views of the same dashboard: revenue, growth, health, opportunities.
                path: ':section',
                title: 'Business overview',
                data: { permission: 'Platform.Insights.View', breadcrumb: (_: unknown, p: Record<string, string>) => p['section'].replace(/^./, (c) => c.toUpperCase()) },
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
                data: { permission: 'Platform.Accounts.Own' },
                loadComponent: () => import('./features/platform/accounts-page').then((m) => m.AccountsPage),
              },
              {
                path: ':view',
                title: 'My accounts',
                data: { permission: 'Platform.Accounts.Own', breadcrumb: (_: unknown, p: Record<string, string>) => ({ health: 'Account health', subscriptions: 'Subscriptions', opportunities: 'Opportunities', support: 'Support & requests' })[p['view']] ?? p['view'] },
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
                data: { permission: 'Platform.Customers.View' },
                loadComponent: () => import('./features/platform/customers-page').then((m) => m.CustomersPage),
              },
              {
                path: ':organisationId',
                title: 'Customer',
                data: { permission: 'Platform.Customers.View', breadcrumb: (_: unknown, p: Record<string, string>) => p['organisationId'] },
                loadComponent: () => import('./features/platform/customer-page').then((m) => m.CustomerPage),
              },
            ],
          },
          {
            path: 'templates',
            title: 'Document templates',
            data: { permission: 'Platform.View', breadcrumb: 'Document templates' },
            loadComponent: () => import('./features/platform/document-templates-page').then((m) => m.DocumentTemplatesPage),
          },
          {
            path: 'packages',
            title: 'Packages & features',
            data: { permission: 'Platform.Subscriptions.View', breadcrumb: 'Packages & features' },
            loadComponent: () => import('./features/platform/packages-page').then((m) => m.PackagesPage),
          },
          planned('flags', 'Feature flags', 'Platform.Config.Manage', 9, 'Roll features out safely: per environment, per customer, per percentage — separate from commercial entitlements.', [
            'Flags are technical (is it switched on?); entitlements are commercial (has the customer got it?)',
            'Kill switches and gradual rollout, every change audited',
          ]),
          {
            path: 'users',
            title: 'Users & impersonation',
            data: { permission: 'Platform.Customers.Users', breadcrumb: 'Users & impersonation' },
            loadComponent: () => import('./features/platform/platform-users-page').then((m) => m.PlatformUsersPage),
          },
          {
            path: 'audit',
            title: 'Platform audit log',
            data: { permission: 'Platform.Audit', breadcrumb: 'Audit log', platform: true },
            loadComponent: () => import('./features/audit/audit-page').then((m) => m.AuditPage),
          },
          { path: 'plans', redirectTo: 'packages' },
          planned('health', 'Platform health', 'Platform.Operations.View', 9, 'Uptime, background jobs, integrations and error rates.'),
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
