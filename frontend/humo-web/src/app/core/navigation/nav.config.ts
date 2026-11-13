import { NavSection } from './nav.model';

/**
 * The single source of truth for navigation (see docs/02-ux-review.md §4.1).
 * The sidebar, mobile tab bar and command palette are derived from this and
 * filtered by permission (the same one the route needs) and plan features.
 * `audience` is presentation only: Humo roles that share a permission still get
 * their own menus (the Account Manager has "My accounts", not "Customers").
 *
 * Order follows frequency of use: queues first, then the scheme a person works
 * in, then reference modules.
 */
export const NAV: NavSection[] = [
  {
    id: 'work',
    label: 'My work',
    nodes: [
      { id: 'dashboard', label: 'Dashboard', icon: 'grid-outline', route: '/dashboard', permission: 'Work.View', keywords: 'home attention today overview' },
      { id: 'tasks', label: 'Tasks', icon: 'checkmark-done-outline', route: '/tasks', permission: 'Work.View', badge: 'tasks', keywords: 'to do work queue follow up' },
      { id: 'approvals', label: 'Approvals', icon: 'shield-checkmark-outline', route: '/approvals', permission: 'Approvals.Decide', badge: 'approvals', badgeTone: 'attention', keywords: 'approve quote invoice authorise payment' },
      { id: 'inbox', label: 'Inbox', icon: 'mail-outline', route: '/inbox', permission: 'Messages.Reply', badge: 'inbox', keywords: 'messages owners reply' },
    ],
  },
  {
    id: 'resident',
    nodes: [
      { id: 'my-home', label: 'Home', icon: 'home-outline', route: '/my/home', permission: 'Resident.Portal' },
      { id: 'my-welcome', label: 'Home', icon: 'home-outline', route: '/my/welcome', permission: 'Statements.ViewPast' },
      { id: 'my-account', label: 'My account', icon: 'wallet-outline', route: '/my/account', permission: 'Account.ViewOwn', keywords: 'balance levy pay statement' },
      { id: 'my-requests', label: 'Maintenance', icon: 'construct-outline', route: '/my/requests', permission: 'Resident.Portal', keywords: 'repair report problem' },
      { id: 'my-documents', label: 'Documents', icon: 'folder-open-outline', route: '/my/documents', permission: 'Resident.Portal' },
      { id: 'my-messages', label: 'Messages', icon: 'chatbubbles-outline', route: '/my/messages', permission: 'Resident.Portal', keywords: 'contact managing agent question' },
      { id: 'my-notices', label: 'Notices', icon: 'megaphone-outline', route: '/my/notices', permission: 'Resident.Portal' },
    ],
  },
  {
    id: 'platform',
    nodes: [
      // Each Humo role's home page first; then the work, grouped by what it's for.
      { id: 'exec-overview', label: 'Overview', icon: 'analytics-outline', route: '/platform/executive', permission: 'Platform.Insights.View', keywords: 'mrr arr board business' },
      { id: 'am-accounts', label: 'My accounts', icon: 'heart-outline', route: '/platform/accounts', permission: 'Platform.Accounts.Own', keywords: 'customer portfolio' },
      {
        id: 'humo-customers',
        label: 'Customers',
        icon: 'business-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'platform-account-requests', label: 'New accounts', route: '/platform/account-requests', permission: 'Platform.Customers.Manage', keywords: 'onboard new customer account approval approve reject delegated activation' },
          { id: 'platform-customers', label: 'All customers', route: '/platform/customers', permission: 'Platform.Customers.View', audience: ['system-admin', 'humo-support', 'humo-executive', 'humo-finance'], keywords: 'agencies organisations subscriptions marula' },
          { id: 'exec-health', label: 'Account health', route: '/platform/executive/health', permission: 'Platform.Insights.View', audience: ['humo-executive'], keywords: 'at risk critical' },
          { id: 'am-health', label: 'Account health', route: '/platform/accounts/health', permission: 'Platform.Accounts.Own', keywords: 'at risk adoption' },
          { id: 'am-subscriptions', label: 'Subscriptions', route: '/platform/accounts/subscriptions', permission: 'Platform.Accounts.Own', keywords: 'package add-ons renewals entitlements' },
          { id: 'exec-opps', label: 'Opportunities', route: '/platform/executive/opportunities', permission: 'Platform.Insights.View', audience: ['humo-executive'], keywords: 'expansion upgrade' },
          { id: 'am-opps', label: 'Opportunities', route: '/platform/accounts/opportunities', permission: 'Platform.Accounts.Own', keywords: 'expansion upgrade training' },
          { id: 'am-support', label: 'Support & requests', route: '/platform/accounts/support', permission: 'Platform.Accounts.Own', keywords: 'tickets escalations upgrade requests' },
        ],
      },
      {
        id: 'humo-business',
        label: 'Business',
        icon: 'trending-up-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'exec-revenue', label: 'Revenue', route: '/platform/executive/revenue', permission: 'Platform.Insights.View', audience: ['humo-executive'], keywords: 'mrr arr package' },
          { id: 'exec-growth', label: 'Growth', route: '/platform/executive/growth', permission: 'Platform.Insights.View', audience: ['humo-executive'], keywords: 'new customers churn retention adoption' },
          { id: 'platform-invoices', label: 'Invoices', route: '/platform/invoices', permission: 'Platform.Revenue.View', keywords: 'billing invoices payments overdue eft card outstanding' },
          { id: 'platform-pricing', label: 'Pricing & add-ons', route: '/platform/pricing', permission: 'Platform.Revenue.View', keywords: 'prices catalogue add-ons storage whatsapp vat proration billing invoices' },
        ],
      },
      {
        id: 'humo-product',
        label: 'Product',
        icon: 'cube-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'platform-packages', label: 'Packages & features', route: '/platform/packages', permission: 'Platform.Packages.Manage', keywords: 'entitlements add-ons catalogue nudges' },
          { id: 'platform-flags', label: 'Feature flags', route: '/platform/flags', permission: 'Platform.Config.Manage' },
          { id: 'platform-templates', label: 'Document templates', route: '/platform/templates', permission: 'Platform.View', audience: ['system-admin', 'humo-account-manager', 'humo-executive'], keywords: 'statement templates enterprise custom adoption pdf' },
        ],
      },
      {
        id: 'humo-people',
        label: 'People',
        icon: 'people-circle-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'platform-team', label: 'Humo team', route: '/platform/team', permission: 'Platform.View', audience: ['system-admin', 'humo-account-manager', 'humo-support', 'humo-executive'], keywords: 'humo staff invite offboard system administrator account manager support roles' },
          { id: 'platform-users', label: 'Users & impersonation', route: '/platform/users', permission: 'Platform.Customers.Users', audience: ['system-admin', 'humo-support'], keywords: 'impersonate view as support customer user humo team roles' },
        ],
      },
      // How the platform is running, its settings, and what happened on it.
      {
        id: 'humo-operations',
        label: 'Operations',
        icon: 'pulse-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'platform-health', label: 'Platform health', route: '/platform/health', permission: 'Platform.Operations.View' },
          { id: 'settings-system', label: 'System', route: '/settings/system', permission: 'Platform.Config.Manage' },
          { id: 'platform-audit', label: 'Audit log', route: '/platform/audit', permission: 'Platform.Audit', keywords: 'audit activity security impersonation history' },
          { id: 'platform-logs', label: 'Technical logs', route: '/platform/logs', permission: 'Platform.Logs', keywords: 'serilog errors failures trace' },
        ],
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    nodes: [
      // "Schemes" is rendered with the pinned-scheme list beneath it (see sidebar).
      { id: 'schemes', label: 'Schemes', icon: 'business-outline', route: '/schemes', permission: 'Portfolio.Browse', keywords: 'body corporate hoa estate complex' },
      { id: 'my-scheme', label: 'My scheme', icon: 'business-outline', route: '/schemes/kingfisher-court', permission: 'Portfolio.View', audience: ['trustee'] },
      {
        id: 'portfolio',
        label: 'Portfolio',
        icon: 'layers-outline',
        children: [
          { id: 'units', label: 'Units', route: '/units', permission: 'Portfolio.Browse', keywords: 'section erf flat' },
          { id: 'people', label: 'People', route: '/people', permission: 'Portfolio.Browse', keywords: 'owners tenants trustees residents contacts' },
        ],
      },
      // The agency's own people: who manages what, their workload and away cover. Not portfolio: that's what's managed.
      { id: 'staff', label: 'Team', icon: 'people-outline', route: '/staff', permission: 'Portfolio.Browse', feature: 'team-management', keywords: 'staff team portfolio managers employees workload away cover' },
      {
        id: 'finance',
        label: 'Finance',
        icon: 'wallet-outline',
        children: [
          { id: 'billing', label: 'Levies & billing', route: '/finance/billing', permission: 'Billing.View', feature: 'billing', keywords: 'levy billing run charges statements' },
          { id: 'invoices', label: 'Invoices', route: '/finance/invoices', permission: 'Billing.View', feature: 'invoicing-basic', keywords: 'invoice owner charge bill pay payment email' },
          { id: 'receipts', label: 'Receipts', route: '/finance/receipts', permission: 'Receipts.Allocate', feature: 'payment-allocation', badge: 'receipts', keywords: 'payments bank allocate unallocated deposits' },
          { id: 'credit-control', label: 'Credit control', route: '/finance/credit-control', permission: 'Billing.View', feature: 'credit-control', badge: 'credit-control', keywords: 'debtors arrears collections ageing demand' },
          { id: 'payables', label: 'Payables', route: '/finance/payables', permission: 'Finance.View', feature: 'payables', badge: 'payables', keywords: 'creditors supplier invoices pay payment batch' },
          { id: 'budgets', label: 'Budgets', route: '/finance/budgets', permission: 'Finance.View', feature: 'budgets', keywords: 'budget actual variance' },
          { id: 'billing-rules', label: 'Billing rules', route: '/finance/billing-rules', permission: 'Billing.View', keywords: 'interest rate levy rules financial year-end lifts AGM deadline settings levy billing rules' },
        ],
      },
      {
        id: 'maintenance',
        label: 'Maintenance',
        icon: 'construct-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'jobs', label: 'Jobs', route: '/maintenance', permission: 'Maintenance.Browse', badge: 'jobs', badgeTone: 'attention', keywords: 'requests repairs work orders quotes' },
          { id: 'suppliers', label: 'Suppliers', route: '/suppliers', permission: 'Suppliers.View', feature: 'suppliers', keywords: 'contractors vendors plumber electrician' },
        ],
      },
      {
        id: 'communications',
        label: 'Communications',
        icon: 'chatbubbles-outline',
        children: [
          { id: 'notices', label: 'Notices', route: '/communications/notices', permission: 'Communications.View', keywords: 'announcements notices water outage residents portal' },
          { id: 'compose', label: 'Compose', route: '/communications/compose', permission: 'Messages.Reply', keywords: 'send message sms email whatsapp bulk' },
          { id: 'sent', label: 'Sent', route: '/communications/sent', permission: 'Communications.View', keywords: 'history delivery bounced' },
          { id: 'templates', label: 'Message templates', route: '/communications/templates', permission: 'Messages.Reply', keywords: 'templates reusable message merge fields' },
        ],
      },
      { id: 'documents', label: 'Documents', icon: 'folder-open-outline', route: '/documents', permission: 'Documents.View', keywords: 'files library insurance contracts minutes' },
      {
        id: 'governance',
        label: 'Governance',
        icon: 'library-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'meetings', label: 'Meetings', route: '/governance/meetings', permission: 'Governance.View', feature: 'governance', keywords: 'agm sgm trustee meeting agenda minutes' },
          { id: 'resolutions', label: 'Resolutions & actions', route: '/governance/resolutions', permission: 'Resolutions.View', feature: 'governance' },
          { id: 'trustee-boards', label: 'Trustee boards', route: '/governance/trustees', permission: 'Governance.View', feature: 'trustee-management' },
          { id: 'rules', label: 'Scheme rules', route: '/governance/rules', permission: 'Governance.View', feature: 'scheme-rules', keywords: 'conduct rules enforcement' },
          { id: 'compliance', label: 'Compliance', route: '/compliance', permission: 'Compliance.View', feature: 'compliance', badge: 'compliance', badgeTone: 'attention', keywords: 'csos insurance statutory deadlines' },
        ],
      },
      { id: 'reports', label: 'Reports', icon: 'bar-chart-outline', route: '/reports', permission: 'Reports.View', feature: 'reporting-basic', keywords: 'financial reports income statement' },
    ],
  },
  // Your own pages live in the account menu (your name, top right). Kept here so the command palette finds them;
  // the sidebar doesn't show this section.
  {
    id: 'account',
    nodes: [
      { id: 'settings-profile', label: 'My profile', icon: 'person-circle-outline', route: '/settings/profile', permission: 'Security.ManageOwn', keywords: 'name phone quiet hours notifications' },
      { id: 'settings-security', label: 'Security', icon: 'lock-closed-outline', route: '/settings/security', permission: 'Security.ManageOwn', keywords: 'passkey windows hello face id devices sessions sign out' },
    ],
  },
  {
    id: 'footer',
    nodes: [
      {
        id: 'settings',
        label: 'Settings',
        icon: 'settings-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'settings-agency', label: 'Agency', route: '/settings/agency', permission: 'Organisation.Manage' },
          { id: 'settings-users', label: 'Users & access', route: '/settings/users', permission: 'Users.Manage', keywords: 'logins invite assign role scope' },
          { id: 'settings-roles', label: 'Roles & permissions', route: '/settings/roles', permission: 'Users.Manage', keywords: 'permission matrix entitlements plan' },
          { id: 'settings-audit', label: 'Audit log', route: '/settings/audit', permission: 'Audit.View', feature: 'audit-log', keywords: 'activity security impersonation history humo access' },
          { id: 'settings-notifications', label: 'Notifications', route: '/settings/notifications', permission: 'Notifications.Configure' },
          { id: 'settings-documents', label: 'Documents & templates', route: '/settings/documents', permission: 'Documents.Configure', keywords: 'statement template branding logo colours pdf print enterprise custom' },
        ],
      },
      {
        id: 'subscription',
        label: 'Plan & billing',
        icon: 'card-outline',
        aloneUsesChildLabel: true,
        children: [
          { id: 'settings-plan', label: 'Plan & features', route: '/settings/plan', permission: 'Subscription.Request', keywords: 'subscription package upgrade add-on governance billing' },
          { id: 'settings-billing', label: 'Humo billing & invoices', route: '/settings/billing', permission: 'Subscription.Request', keywords: 'humo invoices billing payment eft card download' },
        ],
      },
    ],
  },
];
