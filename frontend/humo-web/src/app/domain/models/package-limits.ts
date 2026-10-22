/**
 * What the package includes and how far the organisation has got (D16): units under management and people with a
 * sign-in. `included` is null when the package sets no limit. `state`: ok, warning (80% or more) or reached.
 */
export interface LimitUsage {
  used: number;
  included: number | null;
  state: 'ok' | 'warning' | 'reached';
}

/**
 * The Professional trial (D17): "available" once an Essentials agency is at 80% of a limit, "active" while it runs,
 * "used" once it has run (once per agency), and "not-applicable" otherwise.
 */
export interface ProfessionalTrial {
  status: 'available' | 'active' | 'used' | 'not-applicable';
  /** When a running trial ends (ISO). */
  endsAt: string | null;
}

export interface PackageLimits {
  /** The package's name, e.g. "Humo Essentials". */
  package: string;
  units: LimitUsage;
  users: LimitUsage;
  /** Storage in GB (D20): every uploaded file counts. */
  storage: LimitUsage;
  trial: ProfessionalTrial;
}
