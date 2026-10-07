import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Route, Routes } from '@angular/router';
import { roleGuard } from './core/access/role.guard';
import { SessionService } from './core/session/session.service';
import type { BreadcrumbData } from './core/shell/breadcrumbs/breadcrumbs';
import { Shell } from './core/shell/shell';
import { AGENCY_STAFF, EVERYONE, Role, STAFF_AND_TRUSTEE, Scheme } from './domain';
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

      // ---------------- My work (Attention model) ----------------
      {
        path: 'tasks',
        title: 'Tasks',
        data: { section: 'My work', breadcrumb: 'Tasks', roles: [...STAFF, 'trustee'] },
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
        data: { section: 'My work' },
        children: [
          planned('', 'Dashboard', STAFF_AND_TRUSTEE, 7, 'Start the day knowing what will hurt if it isn’t done today.', [
            '“Today”: overdue and due work from the Attention model, grouped by urgency (not by module)',
            'Exceptions since yesterday: new 90+ day arrears, quotes received, failed debit orders, compliance changes',
            'Scheme health table — which scheme needs me',
            'Role variants: finance, portfolio manager, agency admin (team workload), trustee (one scheme)',
          ]),
        ],
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
              planned('units', 'Units', STAFF, 3, 'Every unit with its owner, occupant, levy and balance.', [
                'Unit list with owner, tenant, participation quota, monthly levy and balance',
                'Click a unit: preview drawer; open: the unit record',
              ]),
              planned('units/:unitId', (r) => `Unit ${r.paramMap.get('unitId')}`, STAFF, 3, 'Everything about one unit: Scheme → Unit → Owner → Account.', [
                'Relationship chain: Scheme › Unit › Owner › Account, every part clickable',
                'Owner and tenant with preview drawers (no context lost)',
                'Account balance, transactions and statements; maintenance; documents; timeline',
              ], (_, p) => `Unit ${p['unitId']}`),
              planned('units/:unitId/account', 'Account', STAFF, 3, 'An owner’s levy account: balance, transactions, arrangements, statements.', [], 'Account'),
              planned('units/:unitId/account/statements/:period', (r) => `Statement ${r.paramMap.get('period')}`, STAFF, 3, 'One statement: opening balance, charges, payments, adjustments, interest, closing balance.', [], (_, p) => `Statement ${p['period']}`),
              planned('people', 'People', STAFF, 3, 'Owners, tenants and trustees of this scheme — one person, many roles.'),
              planned('finance', 'Finance', STAFF_AND_TRUSTEE, 3, 'This scheme’s levy roll, receipts, credit control, payables and budget.'),
              planned('maintenance', 'Maintenance', STAFF_AND_TRUSTEE, 4, 'Jobs for this scheme from request to payment.'),
              planned('suppliers', 'Suppliers', STAFF_AND_TRUSTEE, 4, 'Suppliers serving this scheme, their documents and performance.'),
              planned('documents', 'Documents', STAFF_AND_TRUSTEE, 7, 'This scheme’s documents, filtered from the library.'),
              planned('communications', 'Communications', STAFF, 6, 'Everything sent to and received from this scheme’s people.'),
              planned('meetings', 'Meetings', STAFF_AND_TRUSTEE, 5, 'Trustee meetings, AGMs and SGMs, with resolutions and actions.'),
              planned('compliance', 'Compliance', STAFF_AND_TRUSTEE, 7, 'This scheme’s compliance items, generated from its records.'),
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
            'Each person shows all their units, schemes and roles in a relationship header',
          ], false),
          planned('new', 'Add person', ADMIN_PM, 3, 'Add an owner, tenant or trustee and link them to units.'),
          planned(':personId', 'Person', STAFF, 3, 'Everything about one person across all their units and schemes.'),
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
          planned('billing', 'Levies & billing', STAFF, 6, 'Bill every unit correctly each month.', [
            'Levy schedules per scheme (participation quota, special levies)',
            'Billing runs with status; statements are generated and sent from the run',
          ]),
          planned('billing/new', 'New billing run', ADMIN_FINANCE, 6, 'Run monthly billing safely.', [
            'Scope → Period → Charges preview → Exceptions → Approval (Approvals) → Generate & send statements',
            'Posted runs are locked; corrections are journal adjustments',
          ]),
          planned('receipts', 'Receipts', ADMIN_FINANCE, 3, 'Identify each incoming payment and allocate it to the right owner account.', [
            'Split view: unallocated receipts and suggested matches with confidence and reasons',
            '“Remember this payer” rules, split allocation, suspense account',
          ]),
          planned('credit-control', 'Credit control', STAFF, 6, 'Chase arrears in a structured, fair way.', [
            'Collection pipeline: Reminder → Final demand → Letter of demand → Handed over (+ Arrangement, Disputed)',
            'Ageing (Current · 30 · 60 · 90 · 120+) as a filter and chart',
            'Bulk reminders through Compose',
          ]),
          planned('payables', 'Payables', STAFF_AND_TRUSTEE, 4, 'Capture, match, approve and pay supplier invoices.', [
            'Invoices matched to jobs and approved quotes, with variance flags',
            'Payment batches with dual authorisation via Approvals; remittances',
          ]),
          planned('budgets', 'Budgets', STAFF_AND_TRUSTEE, 5, 'Prepare budgets and track budget vs actual.', [
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
        data: { section: 'Maintenance' },
        children: [
          planned('', 'Jobs', STAFF_AND_TRUSTEE, 4, 'Take every maintenance problem from reported → resolved → paid.', [
            'One Job record: Request → Quotes → Approval → Work order → Scheduled → Completed → Verified → Invoice → Paid',
            'List and board views; closed jobs are a filter (history)',
          ]),
          planned('new', 'Log request', STAFF, 4, 'Capture a problem quickly with the right unit, category and priority.'),
          planned(':requestId', (r) => `Job ${r.paramMap.get('requestId')}`, STAFF_AND_TRUSTEE, 4, 'Work one job end to end: stage tracker, quotes, approval, supplier, invoice, payment, timeline.', [], (_, p) => p['requestId']),
        ],
      },
      {
        path: 'suppliers',
        data: { section: 'Maintenance' },
        children: [
          planned('', 'Suppliers', STAFF_AND_TRUSTEE, 4, 'Find the right, compliant supplier for the job.', [
            'Vetting documents with expiry (COIDA, liability insurance, tax, B-BBEE, bank confirmation)',
            'Performance: on-time %, quote vs invoice variance, resident verification rate',
          ]),
          planned(':supplierId', 'Supplier', STAFF_AND_TRUSTEE, 4, 'One supplier: services, schemes, jobs, quotes, invoices & payments, documents, performance.'),
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
            'A search over every attachment in Humo, with facets: scheme, category, date, related record, uploader',
            'Visibility per document (staff · trustees · owners · one unit) and expiry dates that feed Compliance',
          ], false),
        ],
      },

      // ---------------- Governance & Compliance ----------------
      {
        path: 'governance',
        data: { section: 'Governance' },
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
        data: { section: 'Compliance' },
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
          planned('profile', 'My profile', EVERYONE, 8, 'Your details, password and personal notification preferences.'),
          planned('agency', 'Agency', ADMIN, 8, 'Agency details, branding, trust bank accounts and banking details shown on statements.'),
          planned('users', 'Users & access', ADMIN, 8, 'Invite staff, trustees and residents, and control who can sign in.'),
          planned('roles', 'Roles & permissions', ADMIN, 8, 'Decide what each role can see and do.'),
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
          planned('home', 'Home', RESIDENT, 8, 'See my balance, open requests and latest notices at a glance.', [], false),
          planned('account', 'My account', OWNER, 8, 'Know what I owe, how to pay, and what I’ve paid — statements included.'),
          planned('requests', 'Maintenance', RESIDENT, 8, 'Report a problem and follow it until it’s fixed — then confirm it was.'),
          planned('requests/new', 'Report a problem', RESIDENT, 8, 'Report a problem with photos in under a minute.'),
          planned('documents', 'Documents', RESIDENT, 8, 'Rules, minutes and my own documents.'),
          planned('notices', 'Notices', RESIDENT, 8, 'Announcements from the managing agent and trustees.'),
          { path: 'statements', redirectTo: 'account' },
        ],
      },

      // ---------------- Platform (System Administrator) ----------------
      {
        path: 'platform',
        data: { section: 'Platform' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'agencies' },
          planned('agencies', 'Agencies', SYSADMIN, 8, 'Onboard and support managing agencies on Humo.', [
            'Agency list with plan, schemes, units and health',
            'Support view: enter an agency’s workspace read-only, with an audit trail',
          ]),
          planned('plans', 'Plans & subscriptions', SYSADMIN, 8, 'Manage subscription plans and agency billing.'),
          planned('health', 'Platform health', SYSADMIN, 8, 'Monitor usage, jobs and integrations.'),
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
