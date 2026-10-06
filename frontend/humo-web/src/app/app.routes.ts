import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Route, Routes } from '@angular/router';
import { roleGuard } from './core/access/role.guard';
import { SessionService } from './core/session/session.service';
import { Shell } from './core/shell/shell';
import { AGENCY_STAFF, EVERYONE, Role, STAFF_AND_TRUSTEE, Scheme } from './domain';
import type { BreadcrumbData } from './core/shell/breadcrumbs/breadcrumbs';
import type { PlannedMeta } from './features/planned/planned-page';
import { schemeAccessGuard, schemeResolver } from './features/schemes/scheme.resolver';

const STAFF = AGENCY_STAFF;
const ADMIN: Role[] = ['agency-admin'];
const ADMIN_FINANCE: Role[] = ['agency-admin', 'finance'];
const RESIDENT: Role[] = ['owner', 'tenant'];
const OWNER: Role[] = ['owner'];
const SYSADMIN: Role[] = ['system-admin'];

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
): Route {
  const meta: PlannedMeta = { job, planned: plannedItems, checkpoint };
  return {
    path,
    title,
    loadComponent: () => import('./features/planned/planned-page').then((m) => m.PlannedPage),
    data: { roles, planned: meta, ...(crumb ? { breadcrumb: crumb } : {}) },
  };
}

const schemeName = (d: Record<string, unknown>) => (d['scheme'] as Scheme | undefined)?.name ?? 'Scheme';

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    canActivateChild: [roleGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: () => inject(SessionService).homeRoute() },

      // ---------------- Home & work queue ----------------
      planned('dashboard', 'Dashboard', STAFF_AND_TRUSTEE, 2,
        'Start the day knowing exactly what needs attention across the portfolio.', [
          'Portfolio overview: schemes, units, owners, outstanding debt, open maintenance, pending invoices, compliance items',
          '“Requires attention” list linking straight into the work (overdue jobs, invoices to approve, debtors to follow up)',
          'Portfolio health: collections rate, arrears trend, maintenance ageing, compliance status per scheme',
          'Role-aware variants: finance-focused for accounts staff, single-scheme for trustees',
        ]),
      {
        path: 'tasks',
        data: { section: 'Work' },
        children: [
          planned('', 'Tasks', STAFF, 2, 'One queue for everything that needs action, so nothing falls through the cracks.', [
            'My tasks / Team tasks with due dates, scheme and linked record',
            'Generated tasks (e.g. “follow up 90-day debtor”) and manual tasks',
            'Bulk complete, reassign and snooze',
          ]),
          planned('approvals', 'Approvals', STAFF_AND_TRUSTEE, 2, 'Approve quotes and supplier invoices quickly, with the right context.', [
            'Quotes and invoices awaiting approval, with amount, supplier, scheme and budget impact',
            'Approve / reject with comment; approval history',
            'Mobile-friendly for trustees approving on the go',
          ]),
        ],
      },

      // ---------------- Portfolio ----------------
      {
        path: 'schemes',
        data: { section: 'Portfolio', breadcrumb: 'Schemes' },
        children: [
          planned('', 'Schemes', STAFF, 3, 'Find a scheme and see its health at a glance.', [
            'Scheme list with type, units, arrears, open maintenance, compliance status and portfolio manager',
            'Filters: manager, type, province, health; saved views',
          ], false),
          {
            path: ':schemeId',
            canActivate: [schemeAccessGuard],
            resolve: { scheme: schemeResolver },
            data: { roles: STAFF_AND_TRUSTEE, breadcrumb: schemeName },
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'overview' },
              planned('overview', 'Overview', STAFF_AND_TRUSTEE, 3, 'Understand this scheme’s overall health immediately.', [
                'Financial health, outstanding debt, maintenance status, upcoming meetings, compliance',
                'Recent communication, maintenance and transactions',
                'Tabs: Units · People · Finance · Maintenance · Suppliers · Documents · Communications · Meetings · Compliance · Reports',
              ]),
              planned('units', 'Units', STAFF_AND_TRUSTEE, 3, 'See every unit in the scheme with owner, occupancy and balance.'),
              planned('units/:unitId', (r) => `Unit ${r.paramMap.get('unitId')}`, STAFF_AND_TRUSTEE, 3, 'See everything about one unit: Scheme → Unit → Owner → Account.', [
                'Property info, owner, tenant, levy and participation quota',
                'Account balance, payment history, statements',
                'Maintenance history, documents, communication history',
              ], (_, p) => `Unit ${p['unitId']}`),
              planned('people', 'People', STAFF_AND_TRUSTEE, 3, 'Owners, tenants and trustees of this scheme.'),
              planned('finance', 'Finance', STAFF_AND_TRUSTEE, 4, 'This scheme’s levies, receipts, debtors, invoices and budget.'),
              planned('maintenance', 'Maintenance', STAFF_AND_TRUSTEE, 5, 'Maintenance requests and jobs for this scheme.'),
              planned('suppliers', 'Suppliers', STAFF_AND_TRUSTEE, 5, 'Suppliers serving this scheme and their performance.'),
              planned('documents', 'Documents', STAFF_AND_TRUSTEE, 6, 'This scheme’s document library.'),
              planned('communications', 'Communications', STAFF_AND_TRUSTEE, 6, 'Everything sent to and received from this scheme’s people.'),
              planned('meetings', 'Meetings', STAFF_AND_TRUSTEE, 7, 'Trustee meetings, AGMs and SGMs for this scheme.'),
              planned('compliance', 'Compliance', STAFF_AND_TRUSTEE, 7, 'This scheme’s compliance items and deadlines.'),
              planned('reports', 'Reports', STAFF_AND_TRUSTEE, 8, 'Reports scoped to this scheme.'),
            ],
          },
        ],
      },
      {
        path: 'units',
        data: { section: 'Portfolio' },
        children: [planned('', 'Units', STAFF, 3, 'Find any unit across all schemes, e.g. “KC 42”.')],
      },
      {
        path: 'people',
        data: { section: 'Portfolio', breadcrumb: 'People' },
        children: [
          planned('', 'People', STAFF, 3, 'One directory of owners, tenants and trustees — one person can hold several roles.', [
            'Tabs: All · Owners · Tenants · Trustees (filtered views of the same people)',
            'Each person shows their units, schemes and roles',
          ], false),
          planned('new', 'Add person', ['agency-admin', 'portfolio-manager'], 3, 'Add an owner, tenant or trustee and link them to units.'),
          planned(':personId', 'Person', STAFF, 3, 'Everything about one person across all their units and schemes.'),
        ],
      },
      {
        path: 'staff',
        data: { section: 'Portfolio', breadcrumb: 'Staff' },
        children: [
          planned('', 'Staff', STAFF, 3, 'See who manages what, and each person’s workload.', [
            'Team list with role, assigned schemes, open tasks and maintenance',
            'Assign schemes to portfolio managers',
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
          planned('billing', 'Levies & billing', STAFF, 4, 'Bill every unit correctly each month.', [
            'Levy schedules per scheme (participation quota, special levies)',
            'Billing runs list with status',
          ]),
          planned('billing/new', 'New billing run', ADMIN_FINANCE, 4, 'Run monthly billing safely.', [
            'Wizard: select scheme → period → review charges → review exceptions → approve → generate statements',
          ]),
          planned('receipts', 'Receipts & allocation', ADMIN_FINANCE, 4, 'Identify each incoming payment and allocate it to the right owner account.', [
            'Bank import with auto-matched and unallocated receipts',
            'Allocation panel with suggested matches by reference, amount and payer',
          ]),
          planned('statements', 'Statements', STAFF, 4, 'Produce and send levy statements.', [
            'Opening balance, charges, payments, adjustments, interest, closing balance',
          ]),
          planned('statements/:accountId', 'Statement', STAFF, 4, 'One account’s statement.'),
          planned('debtors', 'Debtors', STAFF, 4, 'Chase arrears in a structured, fair way.', [
            'Ageing: Current · 30 · 60 · 90 · 120+ days',
            'Filters and bulk actions: reminder, letter of demand, payment arrangement, hand over',
          ]),
          planned('supplier-invoices', 'Supplier invoices', STAFF_AND_TRUSTEE, 4, 'Capture, approve and pay supplier invoices.', [
            'Invoice inbox → capture → match to job/quote → trustee approval → payment batch',
          ]),
          planned('budgets', 'Budgets', STAFF_AND_TRUSTEE, 4, 'Prepare budgets and track budget vs actual.', [
            'Budget vs Actual vs Variance by category with visual comparison',
          ]),
          planned('reports', 'Financial reports', STAFF_AND_TRUSTEE, 4, 'Produce trustee-ready financial reports.'),
        ],
      },

      // ---------------- Maintenance & Suppliers ----------------
      {
        path: 'maintenance',
        data: { section: 'Maintenance' },
        children: [
          planned('', 'Requests', STAFF_AND_TRUSTEE, 5, 'Take every maintenance problem from reported → resolved.', [
            'List and board views across stages: Received → Review → Assigned → Quote → Approval → Scheduled → In progress → Completed → Verified → Closed',
            'Closed requests are a filter (history), not a separate page',
          ]),
          planned('new', 'Log request', STAFF, 5, 'Capture a problem quickly with the right unit, category and priority.'),
          planned('quotes', 'Quotes & approvals', STAFF_AND_TRUSTEE, 5, 'Compare quotes and get them approved.'),
          planned(':requestId', 'Request', STAFF_AND_TRUSTEE, 5, 'Work one request: photos, contractor, quote, cost, comments, activity.'),
        ],
      },
      {
        path: 'suppliers',
        data: { section: 'Suppliers' },
        children: [
          planned('', 'Supplier directory', STAFF_AND_TRUSTEE, 5, 'Find the right, compliant supplier for the job.', [], 'Directory'),
          planned('performance', 'Supplier performance', STAFF, 5, 'See which suppliers deliver on time and on budget.', [], 'Performance'),
          planned(':supplierId', 'Supplier', STAFF_AND_TRUSTEE, 5, 'One supplier: services, schemes, jobs, quotes, invoices, documents, performance.'),
        ],
      },

      // ---------------- Communications & Documents ----------------
      {
        path: 'communications',
        data: { section: 'Communications' },
        children: [
          planned('', 'Inbox', STAFF, 6, 'Reply to owners, tenants and trustees without losing track.'),
          planned('announcements', 'Announcements & notices', STAFF_AND_TRUSTEE, 6, 'Tell the right people the right thing.'),
          planned('compose', 'New announcement', STAFF, 6, 'Compose to a scheme, units or people, from a template.'),
          planned('history', 'Sent history', STAFF, 6, 'Prove what was sent, to whom and when.'),
          planned('templates', 'Templates', STAFF, 6, 'Reusable messages: levy reminders, AGM notices, water outages.'),
        ],
      },
      {
        path: 'documents',
        data: { section: 'Documents' },
        children: [
          planned('', 'Documents', STAFF_AND_TRUSTEE, 6, 'Quickly find the right document for the right scheme.', [
            'One library with facets: scheme, category, date, related entity, uploaded by',
            'Categories: Governance · Financial · Insurance · Contracts · Maintenance · Meetings · CSOS · Correspondence',
          ], false),
        ],
      },

      // ---------------- Governance & Compliance ----------------
      {
        path: 'governance',
        data: { section: 'Governance' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'meetings' },
          planned('meetings', 'Meetings', STAFF_AND_TRUSTEE, 7, 'Prepare, run and minute meetings, including AGMs and SGMs.'),
          planned('meetings/new', 'Schedule meeting', ['agency-admin', 'portfolio-manager'], 7, 'Schedule a trustee meeting, AGM or SGM.'),
          planned('meetings/:meetingId', 'Meeting', STAFF_AND_TRUSTEE, 7, 'Agenda, attendees, documents, decisions, action items and minutes.'),
          planned('resolutions', 'Resolutions & actions', STAFF_AND_TRUSTEE, 7, 'Track what was decided and whether it was done.', [
            'Resolution → Meeting → Decision → Action → Assigned person → Status',
          ]),
          planned('trustees', 'Trustee boards', STAFF_AND_TRUSTEE, 7, 'Who serves on each board, in which role, and since when.'),
          planned('rules', 'Scheme rules', STAFF_AND_TRUSTEE, 7, 'Keep rules current and support their enforcement.'),
        ],
      },
      {
        path: 'compliance',
        data: { section: 'Compliance' },
        children: [
          planned('', 'Compliance', STAFF_AND_TRUSTEE, 7, 'Know what is due, overdue or complete across every scheme.', [
            'Items like insurance renewal, CSOS submission, AGM, trustee documentation',
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
          planned('', 'Reports', STAFF_AND_TRUSTEE, 8, 'Portfolio and scheme reporting.', [], false),
          planned(':reportId', 'Report', STAFF_AND_TRUSTEE, 8, 'View, filter and export one report.'),
        ],
      },

      // ---------------- Settings ----------------
      {
        path: 'settings',
        data: { section: 'Settings' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'profile' },
          planned('profile', 'My profile', EVERYONE, 8, 'Your details, password and personal notification preferences.'),
          planned('agency', 'Agency', ADMIN, 8, 'Agency details, branding, bank accounts and banking details shown on statements.'),
          planned('users', 'Users & access', ADMIN, 8, 'Invite staff, trustees and residents, and control who can sign in.'),
          planned('roles', 'Roles & permissions', ADMIN, 8, 'Decide what each role can see and do.'),
          planned('notifications', 'Notifications', ADMIN, 8, 'Agency-wide notification rules and channels.'),
          planned('billing', 'Billing configuration', ADMIN_FINANCE, 8, 'Interest rates, billing day, statement layout and levy rules.'),
          planned('system', 'System', SYSADMIN, 8, 'Platform-wide configuration.'),
        ],
      },

      // ---------------- Resident portal ----------------
      {
        path: 'my',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'home' },
          planned('home', 'Home', RESIDENT, 8, 'See my balance, open requests and latest notices at a glance.', [], false),
          planned('account', 'My account', OWNER, 8, 'Know what I owe, how to pay, and what I’ve paid.'),
          planned('statements', 'Statements', OWNER, 8, 'Download my levy statements.'),
          planned('requests', 'Maintenance', RESIDENT, 8, 'Report a problem and follow it until it’s fixed.'),
          planned('requests/new', 'Report a problem', RESIDENT, 8, 'Report a problem with photos in under a minute.'),
          planned('documents', 'Documents', RESIDENT, 8, 'Rules, minutes and my own documents.'),
          planned('notices', 'Notices', RESIDENT, 8, 'Announcements from the managing agent and trustees.'),
        ],
      },

      // ---------------- Platform (System Administrator) ----------------
      {
        path: 'platform',
        data: { section: 'Platform' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'agencies' },
          planned('agencies', 'Agencies', SYSADMIN, 8, 'Onboard and support managing agencies on Humo.'),
          planned('plans', 'Plans & subscriptions', SYSADMIN, 8, 'Manage subscription plans and agency billing.'),
          planned('health', 'Platform health', SYSADMIN, 8, 'Monitor usage, jobs and integrations.'),
        ],
      },

      {
        path: '**',
        title: 'Page not found',
        loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
