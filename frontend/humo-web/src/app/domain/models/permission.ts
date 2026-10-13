import { Role } from './role';

/**
 * What an identity may DO. A role carries a default set of permissions;
 * the assignment decides WHERE (scope). Permission names are the contract with
 * the future .NET authorisation policies — the API enforces them server-side.
 * The UI only uses them to hide or disable what someone can't do.
 */
export type Permission =
  // Work & approvals
  | 'Work.View'
  | 'Work.Manage'
  | 'Approvals.Decide'
  | 'Messages.Reply'
  // Portfolio
  | 'Portfolio.View'
  | 'Portfolio.BrowseAgency'
  | 'Portfolio.Browse'
  | 'Schemes.Manage'
  | 'Units.Manage'
  | 'People.Manage'
  | 'Accounts.View'
  | 'Account.ViewOwn'
  | 'Notes.Add'
  // Finance
  | 'Finance.View'
  | 'Billing.View'
  | 'Billing.Run'
  | 'Receipts.Allocate'
  | 'Collections.Manage'
  | 'Budgets.Manage'
  | 'Payables.Prepare'
  | 'Payables.Release'
  | 'Finance.Export'
  // Maintenance
  | 'Maintenance.View'
  | 'Maintenance.Log'
  | 'Maintenance.Manage'
  | 'Suppliers.View'
  | 'Suppliers.Manage'
  | 'Suppliers.ChangeBankDetails'
  // Records & governance
  | 'Communications.View'
  | 'Documents.View'
  | 'Documents.Manage'
  | 'Governance.View'
  | 'Meetings.Manage'
  | 'Rules.Enforce'
  | 'Compliance.View'
  | 'Compliance.Manage'
  | 'Reports.View'
  // Residents
  | 'Resident.Portal'
  | 'Resident.Requests'
  // Agency administration
  | 'Organisation.Manage'
  | 'Documents.Configure'
  | 'Notifications.Configure'
  | 'Users.Manage'
  | 'Users.ManageAdmins'
  | 'Audit.View'
  | 'Security.ManageOwn'
  // The customer's own subscription
  | 'Subscription.View'
  | 'Subscription.Request'
  // Humo platform
  | 'Platform.View'
  | 'Platform.Customers.View'
  | 'Platform.Customers.Manage'
  | 'Platform.Customers.Approve'
  | 'Platform.Customers.ActivateWithoutApproval'
  | 'Platform.Customers.Users'
  | 'Platform.Accounts.Own'
  | 'Platform.Subscriptions.View'
  | 'Platform.Subscriptions.Manage'
  | 'Platform.Packages.Manage'
  | 'Platform.Billing.Manage'
  | 'Platform.Templates.Manage'
  | 'Platform.Health.View'
  | 'Platform.Revenue.View'
  | 'Platform.Insights.View'
  | 'Platform.Opportunities.Manage'
  | 'Platform.Support.Assist'
  | 'Platform.Config.Manage'
  | 'Platform.Operations.View'
  | 'Platform.Operations.Manage'
  | 'Platform.ManageHumoRoles'
  | 'Platform.Audit'
  | 'System.Impersonate';

export type PermissionArea = 'Work' | 'Portfolio' | 'Finance' | 'Maintenance' | 'Records' | 'Residents' | 'Administration' | 'Platform';

export interface PermissionMeta {
  id: Permission;
  area: PermissionArea;
  label: string;
  /** Changes data. Blocked in Observe impersonation (UI hides it; the API rejects it). */
  mutates: boolean;
  /** Requires step-up verification at the moment it is used. */
  stepUp?: boolean;
}

export const PERMISSIONS: PermissionMeta[] = [
  { id: 'Work.View', area: 'Work', label: 'See the dashboard and task queues', mutates: false },
  { id: 'Work.Manage', area: 'Work', label: 'Complete, assign and reopen tasks', mutates: true },
  { id: 'Approvals.Decide', area: 'Work', label: 'Approve or reject (within the approval’s rules)', mutates: true },
  { id: 'Messages.Reply', area: 'Work', label: 'Read and reply to messages; send notices', mutates: true },
  { id: 'Portfolio.View', area: 'Portfolio', label: 'Open the schemes in scope', mutates: false },
  { id: 'Portfolio.BrowseAgency', area: 'Portfolio', label: 'Browse every scheme in the agency, read-only (granted individually, D1)', mutates: false },
  { id: 'Portfolio.Browse', area: 'Portfolio', label: 'Browse every scheme, unit, person and staff member in scope', mutates: false },
  { id: 'Schemes.Manage', area: 'Portfolio', label: 'Add schemes, edit them and change their status', mutates: true },
  { id: 'Units.Manage', area: 'Portfolio', label: 'Add and edit units', mutates: true },
  { id: 'People.Manage', area: 'Portfolio', label: 'Add and edit owners, tenants and trustees, and link them to units', mutates: true },
  { id: 'Accounts.View', area: 'Portfolio', label: 'View owner accounts and statements', mutates: false },
  { id: 'Account.ViewOwn', area: 'Residents', label: 'View your own levy account and statements', mutates: false },
  { id: 'Notes.Add', area: 'Portfolio', label: 'Log notes and calls on records', mutates: true },
  { id: 'Finance.View', area: 'Finance', label: 'View payables and budgets', mutates: false },
  { id: 'Billing.View', area: 'Finance', label: 'View levies, billing and credit control', mutates: false },
  { id: 'Billing.Run', area: 'Finance', label: 'Run billing and configure levy rules', mutates: true },
  { id: 'Receipts.Allocate', area: 'Finance', label: 'Allocate receipts to accounts', mutates: true },
  { id: 'Collections.Manage', area: 'Finance', label: 'Chase arrears: send letters, record arrangements, hand over', mutates: true },
  { id: 'Payables.Prepare', area: 'Finance', label: 'Prepare supplier payment batches', mutates: true },
  { id: 'Budgets.Manage', area: 'Finance', label: 'Prepare budgets and put them to the AGM', mutates: true },
  { id: 'Payables.Release', area: 'Finance', label: 'Release payments from trust accounts', mutates: true, stepUp: true },
  { id: 'Finance.Export', area: 'Finance', label: 'Export financial and personal data', mutates: false, stepUp: true },
  { id: 'Maintenance.View', area: 'Maintenance', label: 'View maintenance jobs and quotes', mutates: false },
  { id: 'Maintenance.Log', area: 'Maintenance', label: 'Log maintenance requests', mutates: true },
  { id: 'Maintenance.Manage', area: 'Maintenance', label: 'Run jobs: quotes, work orders, invoices', mutates: true },
  { id: 'Suppliers.View', area: 'Maintenance', label: 'View suppliers and their vetting', mutates: false },
  { id: 'Suppliers.Manage', area: 'Maintenance', label: 'Manage suppliers and vetting documents', mutates: true },
  { id: 'Suppliers.ChangeBankDetails', area: 'Maintenance', label: 'Change supplier banking details', mutates: true, stepUp: true },
  { id: 'Communications.View', area: 'Records', label: 'See what was sent to a scheme’s people', mutates: false },
  { id: 'Documents.View', area: 'Records', label: 'Open the document library', mutates: false },
  { id: 'Documents.Manage', area: 'Records', label: 'Upload, edit and archive documents', mutates: true },
  { id: 'Governance.View', area: 'Records', label: 'View meetings, resolutions, boards and rules', mutates: false },
  { id: 'Meetings.Manage', area: 'Records', label: 'Schedule meetings and record decisions', mutates: true },
  { id: 'Rules.Enforce', area: 'Records', label: 'Log rule breaches and send warning letters', mutates: true },
  { id: 'Compliance.View', area: 'Records', label: 'View compliance items and deadlines', mutates: false },
  { id: 'Compliance.Manage', area: 'Records', label: 'Record compliance evidence and add compliance items', mutates: true },
  { id: 'Reports.View', area: 'Records', label: 'Run and view reports', mutates: false },
  { id: 'Resident.Portal', area: 'Residents', label: 'Use the resident portal for your own unit', mutates: false },
  { id: 'Resident.Requests', area: 'Residents', label: 'Report problems and confirm fixes', mutates: true },
  { id: 'Organisation.Manage', area: 'Administration', label: 'Edit agency details and trust bank accounts', mutates: true },
  { id: 'Documents.Configure', area: 'Administration', label: 'Choose default document templates, branding and the agency’s custom template', mutates: true },
  { id: 'Notifications.Configure', area: 'Administration', label: 'Set agency-wide notification rules', mutates: true },
  { id: 'Users.Manage', area: 'Administration', label: 'Assign customer roles and scope', mutates: true, stepUp: true },
  { id: 'Users.ManageAdmins', area: 'Administration', label: 'Add or remove Agency Administrators', mutates: true, stepUp: true },
  { id: 'Audit.View', area: 'Administration', label: 'View the agency’s audit log', mutates: false },
  { id: 'Security.ManageOwn', area: 'Administration', label: 'Manage own passkeys, devices and sessions', mutates: true, stepUp: true },
  { id: 'Subscription.View', area: 'Administration', label: 'See the agency’s package and features', mutates: false },
  { id: 'Subscription.Request', area: 'Administration', label: 'Request a feature or upgrade from Humo', mutates: true },
  { id: 'Platform.View', area: 'Platform', label: 'Use the Humo platform console', mutates: false },
  { id: 'Platform.Customers.View', area: 'Platform', label: 'View customer organisations', mutates: false },
  { id: 'Platform.Customers.Manage', area: 'Platform', label: 'Onboard and configure customer accounts', mutates: true },
  { id: 'Platform.Customers.Approve', area: 'Platform', label: 'Approve or reject new customer accounts', mutates: true },
  { id: 'Platform.Customers.ActivateWithoutApproval', area: 'Platform', label: 'Activate new customer accounts without separate approval (granted individually)', mutates: true },
  { id: 'Platform.Customers.Users', area: 'Platform', label: 'See and assist customer users', mutates: false },
  { id: 'Platform.Accounts.Own', area: 'Platform', label: 'Look after a book of customer accounts', mutates: false },
  { id: 'Platform.Subscriptions.View', area: 'Platform', label: 'View subscriptions and entitlements', mutates: false },
  { id: 'Platform.Subscriptions.Manage', area: 'Platform', label: 'Change packages, add-ons and feature overrides', mutates: true, stepUp: true },
  { id: 'Platform.Packages.Manage', area: 'Platform', label: 'Define packages, add-ons and the feature catalogue', mutates: true, stepUp: true },
  { id: 'Platform.Billing.Manage', area: 'Platform', label: 'Issue Humo invoices and verify customer payments', mutates: true, stepUp: true },
  { id: 'Platform.Templates.Manage', area: 'Platform', label: 'Publish, version and retire Humo document templates', mutates: true },
  { id: 'Platform.Health.View', area: 'Platform', label: 'View account health and adoption', mutates: false },
  { id: 'Platform.Revenue.View', area: 'Platform', label: 'View MRR, ARR and contract values', mutates: false },
  { id: 'Platform.Insights.View', area: 'Platform', label: 'View company-wide business insights', mutates: false },
  { id: 'Platform.Opportunities.Manage', area: 'Platform', label: 'Work opportunities and upgrade requests', mutates: true },
  { id: 'Platform.Support.Assist', area: 'Platform', label: 'Assist with customer users, recovery and escalation', mutates: true },
  { id: 'Platform.Config.Manage', area: 'Platform', label: 'Platform configuration, feature flags and integrations', mutates: true, stepUp: true },
  { id: 'Platform.Operations.View', area: 'Platform', label: 'View platform uptime, jobs and integrations', mutates: false },
  { id: 'Platform.Operations.Manage', area: 'Platform', label: 'Retry background jobs and run incidents', mutates: true },
  { id: 'Platform.ManageHumoRoles', area: 'Platform', label: 'Grant Humo internal roles', mutates: true, stepUp: true },
  { id: 'Platform.Audit', area: 'Platform', label: 'View the platform-wide audit log', mutates: false },
  { id: 'System.Impersonate', area: 'Platform', label: 'Impersonate a customer user (granted individually)', mutates: false },
];

export const PERMISSION_META: Record<Permission, PermissionMeta> = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p])) as Record<
  Permission,
  PermissionMeta
>;

const STAFF_BASE: Permission[] = [
  'Work.View', 'Work.Manage', 'Messages.Reply', 'Portfolio.View', 'Portfolio.Browse', 'Notes.Add', 'Maintenance.View', 'Maintenance.Log', 'Suppliers.View',
  'Communications.View', 'Documents.View', 'Governance.View', 'Compliance.View', 'Reports.View', 'Subscription.View', 'Security.ManageOwn',
];
/** What trustees see of their scheme: the same records as staff, without the agency's tools. */
const TRUSTEE_VIEW: Permission[] = [
  'Work.View', 'Portfolio.View', 'Finance.View', 'Maintenance.View', 'Suppliers.View', 'Communications.View', 'Documents.View', 'Governance.View',
  'Compliance.View', 'Reports.View',
];

/**
 * Default permissions per role. Prototype assumption: fixed roles first;
 * custom roles (an agency editing these) are a later, Enterprise-plan feature.
 *
 * System.Impersonate, Platform.Customers.ActivateWithoutApproval and
 * Portfolio.BrowseAgency (D1) are deliberately absent from every role — they're granted to named individuals
 * only (see RoleAssignment.grants), by a System Administrator.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  'agency-admin': [
    ...STAFF_BASE, 'Approvals.Decide', 'Schemes.Manage', 'Units.Manage', 'People.Manage', 'Accounts.View', 'Finance.View', 'Billing.View', 'Billing.Run', 'Receipts.Allocate', 'Collections.Manage', 'Budgets.Manage', 'Rules.Enforce',
    'Payables.Prepare', 'Payables.Release', 'Finance.Export', 'Maintenance.Manage', 'Suppliers.Manage', 'Suppliers.ChangeBankDetails',
    'Meetings.Manage', 'Documents.Manage', 'Compliance.Manage', 'Organisation.Manage', 'Documents.Configure', 'Notifications.Configure', 'Users.Manage', 'Users.ManageAdmins', 'Audit.View', 'Subscription.Request',
  ],
  'portfolio-manager': [
    ...STAFF_BASE, 'Approvals.Decide', 'Units.Manage', 'People.Manage', 'Accounts.View', 'Finance.View', 'Billing.View', 'Collections.Manage', 'Budgets.Manage', 'Rules.Enforce', 'Maintenance.Manage', 'Suppliers.Manage',
    'Meetings.Manage', 'Documents.Manage', 'Compliance.Manage', 'Notifications.Configure',
  ],
  finance: [
    ...STAFF_BASE, 'Approvals.Decide', 'Accounts.View', 'Finance.View', 'Billing.View', 'Billing.Run', 'Receipts.Allocate', 'Collections.Manage', 'Budgets.Manage', 'Payables.Prepare',
    'Payables.Release', 'Finance.Export', 'Suppliers.ChangeBankDetails', 'Documents.Manage',
  ],
  operations: [...STAFF_BASE, 'Maintenance.Manage', 'Suppliers.Manage', 'Documents.Manage'],
  trustee: [...TRUSTEE_VIEW, 'Work.Manage', 'Approvals.Decide', 'Security.ManageOwn'],
  owner: ['Resident.Portal', 'Account.ViewOwn', 'Resident.Requests', 'Security.ManageOwn'],
  tenant: ['Resident.Portal', 'Resident.Requests', 'Security.ManageOwn'],
  // Highest operational authority — but impersonation is still an individual grant.
  'system-admin': [
    'Platform.View', 'Platform.Customers.View', 'Platform.Customers.Manage', 'Platform.Customers.Approve', 'Platform.Customers.Users', 'Platform.Subscriptions.View',
    'Platform.Subscriptions.Manage', 'Platform.Packages.Manage', 'Platform.Billing.Manage', 'Platform.Templates.Manage', 'Platform.Health.View', 'Platform.Revenue.View', 'Platform.Insights.View',
    'Platform.Support.Assist', 'Platform.Config.Manage', 'Platform.Operations.View', 'Platform.Operations.Manage', 'Platform.ManageHumoRoles', 'Platform.Audit', 'Security.ManageOwn',
  ],
  // The customer relationship: onboarding, adoption, health, subscriptions where authorised. No platform config, no Humo roles.
  'humo-account-manager': [
    'Platform.View', 'Platform.Customers.View', 'Platform.Customers.Manage', 'Platform.Customers.Users', 'Platform.Subscriptions.View',
    'Platform.Subscriptions.Manage', 'Platform.Health.View', 'Platform.Revenue.View', 'Platform.Accounts.Own', 'Platform.Opportunities.Manage',
    'Platform.Support.Assist', 'Security.ManageOwn',
  ],
  // Investigates and helps. Can't change packages, configuration, security policy or anyone's roles.
  'humo-support': [
    'Platform.View', 'Platform.Customers.View', 'Platform.Customers.Users', 'Platform.Subscriptions.View', 'Platform.Health.View',
    'Platform.Support.Assist', 'Platform.Operations.View', 'Platform.Operations.Manage', 'Platform.Audit', 'Security.ManageOwn',
  ],
  // Business intelligence: aggregates, revenue and health. Read-only; no customer users or audit detail.
  'humo-executive': [
    'Platform.View', 'Platform.Customers.View', 'Platform.Subscriptions.View', 'Platform.Health.View', 'Platform.Revenue.View', 'Platform.Insights.View',
    'Security.ManageOwn',
  ],
};
