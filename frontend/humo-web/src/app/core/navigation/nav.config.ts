import { AGENCY_STAFF, EVERYONE, Role, STAFF_AND_TRUSTEE } from '../../domain';
import { NavSection } from './nav.model';

const STAFF = AGENCY_STAFF;
const TRUSTEE: readonly Role[] = ['trustee'];
const ADMIN: readonly Role[] = ['agency-admin'];
const ADMIN_FINANCE: readonly Role[] = ['agency-admin', 'finance'];
const OWNER: readonly Role[] = ['owner'];
const RESIDENT: readonly Role[] = ['owner', 'tenant'];
const SYSADMIN: readonly Role[] = ['system-admin'];

/**
 * The single source of truth for navigation.
 * The sidebar, mobile tab bar and command palette are all derived from this
 * and filtered by the current role. Route access rules live in app.routes.ts.
 */
export const NAV: NavSection[] = [
  {
    id: 'primary',
    nodes: [
      // Agency staff + trustee
      { id: 'dashboard', label: 'Dashboard', icon: 'grid-outline', route: '/dashboard', roles: STAFF_AND_TRUSTEE },
      {
        id: 'tasks',
        label: 'Tasks',
        icon: 'checkmark-done-outline',
        route: '/tasks',
        roles: STAFF,
        badge: { count: 12, label: '12 open tasks' },
        keywords: 'to do work queue follow up',
      },
      {
        id: 'approvals',
        label: 'Approvals',
        icon: 'shield-checkmark-outline',
        route: '/tasks/approvals',
        roles: TRUSTEE,
        badge: { count: 4, tone: 'attention', label: '4 items awaiting your approval' },
        keywords: 'approve quote invoice authorise',
      },
      { id: 'my-scheme', label: 'My scheme', icon: 'business-outline', route: '/schemes/kingfisher-court', roles: TRUSTEE },

      // Owners and tenants
      { id: 'my-home', label: 'Home', icon: 'home-outline', route: '/my/home', roles: RESIDENT },
      { id: 'my-account', label: 'My account', icon: 'wallet-outline', route: '/my/account', roles: OWNER, keywords: 'balance levy pay' },
      { id: 'my-statements', label: 'Statements', icon: 'receipt-outline', route: '/my/statements', roles: OWNER },
      { id: 'my-requests', label: 'Maintenance', icon: 'construct-outline', route: '/my/requests', roles: RESIDENT, keywords: 'repair report problem' },
      { id: 'my-documents', label: 'Documents', icon: 'folder-open-outline', route: '/my/documents', roles: RESIDENT },
      { id: 'my-notices', label: 'Notices', icon: 'megaphone-outline', route: '/my/notices', roles: RESIDENT, badge: { count: 2, label: '2 unread notices' } },

      // Platform (System Administrator)
      { id: 'platform-agencies', label: 'Agencies', icon: 'business-outline', route: '/platform/agencies', roles: SYSADMIN, keywords: 'customers tenants' },
      { id: 'platform-plans', label: 'Plans & subscriptions', icon: 'card-outline', route: '/platform/plans', roles: SYSADMIN },
      { id: 'platform-health', label: 'Platform health', icon: 'pulse-outline', route: '/platform/health', roles: SYSADMIN },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    nodes: [
      {
        id: 'portfolio',
        label: 'Portfolio',
        icon: 'business-outline',
        children: [
          { id: 'schemes', label: 'Schemes', route: '/schemes', roles: STAFF, keywords: 'body corporate hoa estate complex' },
          { id: 'units', label: 'Units', route: '/units', roles: STAFF, keywords: 'section erf flat' },
          { id: 'people', label: 'People', route: '/people', roles: STAFF, keywords: 'owners tenants trustees residents contacts' },
          { id: 'staff', label: 'Staff', route: '/staff', roles: STAFF, keywords: 'team portfolio managers employees' },
        ],
      },
      {
        id: 'finance',
        label: 'Finance',
        icon: 'wallet-outline',
        children: [
          { id: 'billing', label: 'Levies & billing', route: '/finance/billing', roles: STAFF, keywords: 'levy billing run charges' },
          {
            id: 'receipts',
            label: 'Receipts & allocation',
            route: '/finance/receipts',
            roles: ADMIN_FINANCE,
            badge: { count: 17, label: '17 unallocated receipts' },
            keywords: 'payments bank allocate unallocated deposits',
          },
          { id: 'statements', label: 'Statements', route: '/finance/statements', roles: STAFF, keywords: 'levy statement account' },
          { id: 'debtors', label: 'Debtors', route: '/finance/debtors', roles: STAFF, keywords: 'arrears credit control aging collections' },
          {
            id: 'supplier-invoices',
            label: 'Supplier invoices',
            route: '/finance/supplier-invoices',
            roles: STAFF_AND_TRUSTEE,
            badge: { count: 4, label: '4 invoices awaiting approval' },
            keywords: 'creditors payables pay suppliers',
          },
          { id: 'budgets', label: 'Budgets', route: '/finance/budgets', roles: STAFF_AND_TRUSTEE, keywords: 'budget actual variance' },
          { id: 'financial-reports', label: 'Financial reports', route: '/finance/reports', roles: STAFF_AND_TRUSTEE, keywords: 'income statement balance sheet cash flow' },
        ],
      },
      {
        id: 'maintenance',
        label: 'Maintenance',
        icon: 'construct-outline',
        children: [
          {
            id: 'requests',
            label: 'Requests',
            route: '/maintenance',
            roles: STAFF_AND_TRUSTEE,
                badge: { count: 8, tone: 'attention', label: '8 overdue requests' },
            keywords: 'jobs repairs work orders',
          },
          { id: 'quotes', label: 'Quotes & approvals', route: '/maintenance/quotes', roles: STAFF_AND_TRUSTEE },
        ],
      },
      {
        id: 'suppliers',
        label: 'Suppliers',
        icon: 'hammer-outline',
        children: [
          { id: 'supplier-directory', label: 'Directory', route: '/suppliers', roles: STAFF_AND_TRUSTEE, keywords: 'contractors vendors plumber electrician' },
          { id: 'supplier-performance', label: 'Performance', route: '/suppliers/performance', roles: STAFF },
        ],
      },
      {
        id: 'communications',
        label: 'Communications',
        icon: 'chatbubbles-outline',
        children: [
          { id: 'inbox', label: 'Inbox', route: '/communications', roles: STAFF, badge: { count: 6, label: '6 messages awaiting a reply' } },
          { id: 'announcements', label: 'Announcements & notices', route: '/communications/announcements', roles: STAFF_AND_TRUSTEE },
          { id: 'comm-history', label: 'Sent history', route: '/communications/history', roles: STAFF },
          { id: 'templates', label: 'Templates', route: '/communications/templates', roles: STAFF },
        ],
      },
      { id: 'documents', label: 'Documents', icon: 'folder-open-outline', route: '/documents', roles: STAFF_AND_TRUSTEE, keywords: 'files library insurance contracts minutes' },
      {
        id: 'governance',
        label: 'Governance',
        icon: 'library-outline',
        children: [
          { id: 'meetings', label: 'Meetings', route: '/governance/meetings', roles: STAFF_AND_TRUSTEE, keywords: 'agm sgm trustee meeting agenda minutes' },
          { id: 'resolutions', label: 'Resolutions & actions', route: '/governance/resolutions', roles: STAFF_AND_TRUSTEE },
          { id: 'trustee-boards', label: 'Trustee boards', route: '/governance/trustees', roles: STAFF_AND_TRUSTEE },
          { id: 'rules', label: 'Scheme rules', route: '/governance/rules', roles: STAFF_AND_TRUSTEE, keywords: 'conduct rules enforcement' },
        ],
      },
      {
        id: 'compliance',
        label: 'Compliance',
        icon: 'shield-checkmark-outline',
        route: '/compliance',
        roles: STAFF_AND_TRUSTEE,
        badge: { count: 7, tone: 'attention', label: '7 items need attention' },
        keywords: 'csos insurance statutory deadlines',
      },
      { id: 'reports', label: 'Reports', icon: 'bar-chart-outline', route: '/reports', roles: STAFF_AND_TRUSTEE },
    ],
  },
  {
    id: 'footer',
    nodes: [
      {
        id: 'settings',
        label: 'Settings',
        icon: 'settings-outline',
        children: [
          { id: 'settings-profile', label: 'My profile', route: '/settings/profile', roles: EVERYONE },
          { id: 'settings-agency', label: 'Agency', route: '/settings/agency', roles: ADMIN },
          { id: 'settings-users', label: 'Users & access', route: '/settings/users', roles: ADMIN, keywords: 'logins invite' },
          { id: 'settings-roles', label: 'Roles & permissions', route: '/settings/roles', roles: ADMIN },
          { id: 'settings-notifications', label: 'Notifications', route: '/settings/notifications', roles: ADMIN },
          { id: 'settings-billing', label: 'Billing configuration', route: '/settings/billing', roles: ADMIN_FINANCE, keywords: 'interest rate levy rules bank accounts' },
          { id: 'settings-system', label: 'System', route: '/settings/system', roles: SYSADMIN },
        ],
      },
    ],
  },
];
