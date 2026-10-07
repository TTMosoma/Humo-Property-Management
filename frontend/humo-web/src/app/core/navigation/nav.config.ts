import { AGENCY_STAFF, EVERYONE, FINANCE_STAFF, Role } from '../../domain';
import { NavSection } from './nav.model';

const STAFF = AGENCY_STAFF;
const STAFF_AND_TRUSTEE: readonly Role[] = [...AGENCY_STAFF, 'trustee'];
/** Money pages: not for Operations (jobs, not ledgers). */
const MONEY: readonly Role[] = FINANCE_STAFF;
const MONEY_AND_TRUSTEE: readonly Role[] = [...FINANCE_STAFF, 'trustee'];
const TRUSTEE: readonly Role[] = ['trustee'];
const ADMIN: readonly Role[] = ['agency-admin'];
const ADMIN_FINANCE: readonly Role[] = ['agency-admin', 'finance'];
const ADMIN_PM: readonly Role[] = ['agency-admin', 'portfolio-manager'];
const OWNER: readonly Role[] = ['owner'];
const RESIDENT: readonly Role[] = ['owner', 'tenant'];
const SYSADMIN: readonly Role[] = ['system-admin'];
const HUMO: readonly Role[] = ['system-admin', 'humo-account-manager', 'humo-support', 'humo-executive'];
const HUMO_OPS: readonly Role[] = ['system-admin', 'humo-support', 'humo-account-manager'];
const HUMO_AUDIT: readonly Role[] = ['system-admin', 'humo-support'];
const SUPPLIER: readonly Role[] = ['supplier'];
const APPROVERS: readonly Role[] = ['agency-admin', 'portfolio-manager', 'finance', 'trustee'];

/**
 * The single source of truth for navigation (see docs/02-ux-review.md §4.1).
 * The sidebar, mobile tab bar and command palette are derived from this and
 * filtered by the current role. Route access rules live in app.routes.ts.
 *
 * Order follows frequency of use: queues first, then the scheme a person works
 * in, then reference modules.
 */
export const NAV: NavSection[] = [
  {
    id: 'work',
    label: 'My work',
    nodes: [
      { id: 'tasks', label: 'Tasks', icon: 'checkmark-done-outline', route: '/tasks', roles: STAFF_AND_TRUSTEE, badge: 'tasks', keywords: 'to do work queue follow up' },
      { id: 'approvals', label: 'Approvals', icon: 'shield-checkmark-outline', route: '/approvals', roles: APPROVERS, badge: 'approvals', badgeTone: 'attention', keywords: 'approve quote invoice authorise payment' },
      { id: 'inbox', label: 'Inbox', icon: 'mail-outline', route: '/inbox', roles: STAFF, badge: 'inbox', keywords: 'messages owners reply' },
      { id: 'dashboard', label: 'Dashboard', icon: 'grid-outline', route: '/dashboard', roles: STAFF_AND_TRUSTEE },
    ],
  },
  {
    id: 'resident',
    nodes: [
      { id: 'my-home', label: 'Home', icon: 'home-outline', route: '/my/home', roles: RESIDENT },
      { id: 'my-account', label: 'My account', icon: 'wallet-outline', route: '/my/account', roles: OWNER, keywords: 'balance levy pay statement' },
      { id: 'my-requests', label: 'Maintenance', icon: 'construct-outline', route: '/my/requests', roles: RESIDENT, keywords: 'repair report problem' },
      { id: 'my-documents', label: 'Documents', icon: 'folder-open-outline', route: '/my/documents', roles: RESIDENT },
      { id: 'my-notices', label: 'Notices', icon: 'megaphone-outline', route: '/my/notices', roles: RESIDENT },
    ],
  },
  {
    id: 'supplier',
    nodes: [{ id: 'supplier-home', label: 'Work orders', icon: 'hammer-outline', route: '/supplier', roles: SUPPLIER }],
  },
  {
    id: 'platform',
    nodes: [
      { id: 'platform-executive', label: 'Business overview', icon: 'analytics-outline', route: '/platform/executive', roles: ['humo-executive', 'system-admin'], keywords: 'mrr arr revenue growth retention board' },
      { id: 'platform-accounts', label: 'My accounts', icon: 'heart-outline', route: '/platform/accounts', roles: ['humo-account-manager'], keywords: 'account health adoption opportunities renewals requests' },
      { id: 'platform-customers', label: 'Customers', icon: 'business-outline', route: '/platform/customers', roles: HUMO, keywords: 'agencies organisations subscriptions tshikrand' },
      { id: 'platform-packages', label: 'Packages & features', icon: 'cube-outline', route: '/platform/packages', roles: ['system-admin', 'humo-account-manager', 'humo-executive'], keywords: 'entitlements add-ons catalogue nudges' },
      { id: 'platform-users', label: 'Users & impersonation', icon: 'people-outline', route: '/platform/users', roles: HUMO_OPS, keywords: 'impersonate view as support customer user humo team roles' },
      { id: 'platform-audit', label: 'Audit log', icon: 'document-lock-outline', route: '/platform/audit', roles: HUMO_AUDIT, keywords: 'audit activity security impersonation history' },
      { id: 'platform-flags', label: 'Feature flags', icon: 'flag-outline', route: '/platform/flags', roles: ['system-admin'] },
      { id: 'platform-health', label: 'Platform health', icon: 'pulse-outline', route: '/platform/health', roles: ['system-admin', 'humo-support'] },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    nodes: [
      // "Schemes" is rendered with the pinned-scheme list beneath it (see sidebar).
      { id: 'schemes', label: 'Schemes', icon: 'business-outline', route: '/schemes', roles: STAFF, keywords: 'body corporate hoa estate complex' },
      { id: 'my-scheme', label: 'My scheme', icon: 'business-outline', route: '/schemes/kingfisher-court', roles: TRUSTEE },
      {
        id: 'portfolio',
        label: 'Portfolio',
        icon: 'layers-outline',
        children: [
          { id: 'units', label: 'Units', route: '/units', roles: STAFF, keywords: 'section erf flat' },
          { id: 'people', label: 'People', route: '/people', roles: STAFF, keywords: 'owners tenants trustees residents contacts' },
          { id: 'staff', label: 'Staff', route: '/staff', roles: STAFF, feature: 'team-management', keywords: 'team portfolio managers employees workload' },
        ],
      },
      {
        id: 'finance',
        label: 'Finance',
        icon: 'wallet-outline',
        children: [
          { id: 'billing', label: 'Levies & billing', route: '/finance/billing', roles: MONEY, feature: 'billing', keywords: 'levy billing run charges statements' },
          { id: 'receipts', label: 'Receipts', route: '/finance/receipts', roles: ADMIN_FINANCE, feature: 'payment-allocation', badge: 'receipts', keywords: 'payments bank allocate unallocated deposits' },
          { id: 'credit-control', label: 'Credit control', route: '/finance/credit-control', roles: MONEY, feature: 'credit-control', badge: 'credit-control', keywords: 'debtors arrears collections ageing demand' },
          { id: 'payables', label: 'Payables', route: '/finance/payables', roles: MONEY_AND_TRUSTEE, feature: 'payables', badge: 'payables', keywords: 'creditors supplier invoices pay payment batch' },
          { id: 'budgets', label: 'Budgets', route: '/finance/budgets', roles: MONEY_AND_TRUSTEE, feature: 'budgets', keywords: 'budget actual variance' },
        ],
      },
      {
        id: 'maintenance',
        label: 'Maintenance',
        icon: 'construct-outline',
        children: [
          { id: 'jobs', label: 'Jobs', route: '/maintenance', roles: STAFF_AND_TRUSTEE, badge: 'jobs', badgeTone: 'attention', keywords: 'requests repairs work orders quotes' },
          { id: 'suppliers', label: 'Suppliers', route: '/suppliers', roles: STAFF_AND_TRUSTEE, feature: 'suppliers', keywords: 'contractors vendors plumber electrician' },
        ],
      },
      {
        id: 'communications',
        label: 'Communications',
        icon: 'chatbubbles-outline',
        children: [
          { id: 'sent', label: 'Sent', route: '/communications/sent', roles: STAFF_AND_TRUSTEE, keywords: 'announcements notices history' },
          { id: 'templates', label: 'Templates', route: '/communications/templates', roles: STAFF },
        ],
      },
      { id: 'documents', label: 'Documents', icon: 'folder-open-outline', route: '/documents', roles: STAFF_AND_TRUSTEE, keywords: 'files library insurance contracts minutes' },
      {
        id: 'governance',
        label: 'Governance',
        icon: 'library-outline',
        children: [
          { id: 'meetings', label: 'Meetings', route: '/governance/meetings', roles: STAFF_AND_TRUSTEE, feature: 'governance', keywords: 'agm sgm trustee meeting agenda minutes' },
          { id: 'resolutions', label: 'Resolutions & actions', route: '/governance/resolutions', roles: STAFF_AND_TRUSTEE, feature: 'governance' },
          { id: 'trustee-boards', label: 'Trustee boards', route: '/governance/trustees', roles: STAFF_AND_TRUSTEE, feature: 'governance' },
          { id: 'rules', label: 'Scheme rules', route: '/governance/rules', roles: STAFF_AND_TRUSTEE, feature: 'governance', keywords: 'conduct rules enforcement' },
        ],
      },
      { id: 'compliance', label: 'Compliance', icon: 'shield-checkmark-outline', route: '/compliance', roles: STAFF_AND_TRUSTEE, feature: 'compliance', badge: 'compliance', badgeTone: 'attention', keywords: 'csos insurance statutory deadlines' },
      { id: 'reports', label: 'Reports', icon: 'bar-chart-outline', route: '/reports', roles: STAFF_AND_TRUSTEE, feature: 'reporting-basic', keywords: 'financial reports income statement' },
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
          { id: 'settings-security', label: 'Security', route: '/settings/security', roles: EVERYONE, keywords: 'passkey windows hello face id devices sessions sign out' },
          { id: 'settings-agency', label: 'Agency', route: '/settings/agency', roles: ADMIN },
          { id: 'settings-users', label: 'Users & access', route: '/settings/users', roles: ADMIN, keywords: 'logins invite assign role scope' },
          { id: 'settings-plan', label: 'Plan & features', route: '/settings/plan', roles: ADMIN, keywords: 'subscription package upgrade add-on governance billing' },
          { id: 'settings-roles', label: 'Roles & permissions', route: '/settings/roles', roles: ADMIN, keywords: 'permission matrix entitlements plan' },
          { id: 'settings-audit', label: 'Audit log', route: '/settings/audit', roles: ADMIN, feature: 'audit-log', keywords: 'activity security impersonation history humo access' },
          { id: 'settings-notifications', label: 'Notifications', route: '/settings/notifications', roles: ADMIN_PM },
          { id: 'settings-billing', label: 'Billing configuration', route: '/settings/billing', roles: ADMIN_FINANCE, keywords: 'interest rate levy rules bank accounts' },
          { id: 'settings-system', label: 'System', route: '/settings/system', roles: SYSADMIN },
        ],
      },
    ],
  },
];
