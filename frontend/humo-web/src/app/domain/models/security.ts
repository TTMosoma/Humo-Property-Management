/**
 * Step-up authentication: an extra proof of identity at the moment of a
 * sensitive action. Humo favours first-party, device-native methods —
 * passkeys (Windows Hello, Face ID, Touch ID) and approval in Humo Mobile —
 * rather than third-party authenticator apps.
 *
 * The backend will implement these with WebAuthn and a signed push challenge;
 * the frontend only asks for "a fresh proof for this action".
 */
export type StepUpMethod = 'passkey' | 'mobile';

/** The sensitive actions that ask for step-up. The API re-checks the proof's freshness. */
export type SensitiveAction =
  | 'release-payment'
  | 'approve-large-amount'
  | 'change-bank-details'
  | 'change-roles'
  | 'add-administrator'
  | 'export-data'
  | 'change-security'
  | 'impersonate-act'
  | 'change-subscription'
  | 'change-customer-status';

export const SENSITIVE_ACTION_LABELS: Record<SensitiveAction, string> = {
  'release-payment': 'Release a supplier payment',
  'approve-large-amount': 'Approve a large amount',
  'change-bank-details': 'Change banking details',
  'change-roles': 'Change someone’s roles',
  'add-administrator': 'Add an administrator',
  'export-data': 'Export sensitive data',
  'change-security': 'Change security settings',
  'impersonate-act': 'Act as a customer user',
  'change-subscription': 'Change a customer’s subscription',
  'change-customer-status': 'Suspend or archive a customer',
};

/** Amounts at or above this need step-up when approved (prototype assumption). */
export const LARGE_APPROVAL_AMOUNT = 50_000;

/** A proof stays fresh for this long, so a run of related actions asks only once. */
export const STEP_UP_FRESH_MS = 5 * 60_000;

export interface StepUpRequest {
  action: SensitiveAction;
  /** Shown in the dialog, e.g. "Release R 58 940.20 from Kingfisher Court’s trust account". */
  detail: string;
}

export interface StepUpResult {
  verified: boolean;
  method?: StepUpMethod;
  /** Device that answered, e.g. "Windows Hello · Studio laptop". */
  device?: string;
  at: string;
}

// ---- Credentials, devices and sessions (Settings › Security) ----

export interface Passkey {
  id: string;
  name: string;
  /** e.g. "Windows Hello", "iCloud Keychain", "Google Password Manager". */
  provider: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface TrustedDevice {
  id: string;
  name: string;
  kind: 'laptop' | 'phone' | 'tablet';
  /** Has Humo Mobile installed and can approve sign-ins and step-up requests. */
  humoMobile: boolean;
  addedAt: string;
  lastSeenAt: string;
}

export interface ActiveSession {
  id: string;
  device: string;
  browser: string;
  location: string;
  ip: string;
  startedAt: string;
  lastActiveAt: string;
  current: boolean;
}

export interface SecurityProfile {
  identityId: string;
  passkeys: Passkey[];
  devices: TrustedDevice[];
  sessions: ActiveSession[];
}
