/**
 * What the package includes and how far the organisation has got (D16): units under management and people with a
 * sign-in. `included` is null when the package sets no limit. `state`: ok, warning (80% or more) or reached.
 */
export interface LimitUsage {
  used: number;
  included: number | null;
  state: 'ok' | 'warning' | 'reached';
}

export interface PackageLimits {
  /** The package's name, e.g. "Humo Essentials". */
  package: string;
  units: LimitUsage;
  users: LimitUsage;
}
