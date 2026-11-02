/**
 * Step-up authentication: an extra proof of identity at the moment of a
 * sensitive action. Humo favours first-party, device-native methods —
 * passkeys (Windows Hello, Face ID, Touch ID) and approval in Humo Mobile —
 * rather than third-party authenticator apps.
 *
 * The backend will implement these with WebAuthn and a signed push challenge;
 * the frontend only asks for "a fresh proof for this action".
 */
export type StepUpMethod = 'passkey' | 'mobile' | 'sms';

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
  | 'change-customer-status'
  | 'change-platform-config'
  | 'change-humo-team'
  | 'verify-payment';

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
  'change-platform-config': 'Change live platform configuration',
  'change-humo-team': 'Change Humo team access',
  'verify-payment': 'Issue a Humo invoice or verify a payment',
};

/** The default passkey approval threshold: each agency sets its own (`Organisation.approvalStepUpAmount`, doc 03). */
export const LARGE_APPROVAL_AMOUNT = 50_000;

/** A proof stays fresh for this long, so a run of related actions asks only once. */
export const STEP_UP_FRESH_MS = 5 * 60_000;

export interface StepUpRequest {
  action: SensitiveAction;
  /** Shown in the dialog, e.g. "Release R 58 940.20 from Kingfisher Court’s trust account". */
  detail: string;
  /** D26: a code by SMS may confirm it, for someone without their passkey (e.g. on a public computer). Approvals only. */
  smsAllowed?: boolean;
}

/** D26: the person's own mobile for SMS codes (My profile). */
export interface MobileStatus {
  /** "the number ending 0101", or null when none is confirmed. */
  mobile: string | null;
  verified: boolean;
  /** Changing it needs the passkey once they have one. */
  hasPasskey: boolean;
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
  /** A browser's answer to "is this your own computer?": true for "mine", false for "shared". Humo Mobile devices are always trusted. */
  trusted: boolean;
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

/** Where a new passkey should live (D30). The browser and device make the final offer; this says what to offer first. */
export type PasskeyTool = 'device' | 'phone' | 'key' | 'manager';

export interface PasskeyToolOption {
  id: PasskeyTool;
  label: string;
  detail: string;
  icon: string;
  /** Shown while the browser's prompt is open. */
  waiting: string;
}

export const PASSKEY_TOOLS: readonly PasskeyToolOption[] = [
  { id: 'device', label: 'This device', detail: 'Windows Hello, Face ID, Touch ID or your screen lock. Best on a computer or phone that’s yours.', icon: 'laptop-outline', waiting: 'Confirm with your fingerprint, face or screen lock.' },
  { id: 'phone', label: 'Phone or tablet', detail: 'Scan a QR code. Works from any computer, and the passkey stays on your phone.', icon: 'phone-portrait-outline', waiting: 'Scan the QR code with your phone or tablet, then confirm on it.' },
  { id: 'key', label: 'Security key', detail: 'A USB or NFC key such as a YubiKey.', icon: 'key-outline', waiting: 'Insert or tap your security key, then touch it when it flashes.' },
  { id: 'manager', label: 'Password manager or browser', detail: 'Shows everything your browser offers, e.g. Google Password Manager, iCloud Keychain, 1Password or Bitwarden.', icon: 'globe-outline', waiting: 'Choose where to save it in the prompt, then confirm.' },
];

export interface SecurityProfile {
  identityId: string;
  passkeys: Passkey[];
  devices: TrustedDevice[];
  sessions: ActiveSession[];
}
