/**
 * Review tools that only exist in the prototype: the floating toolbar ("Sign in
 * as", page-state simulator, latency), "Sign in as someone else" on the
 * signed-out page, and resetting Smart Nudges.
 *
 * Only the mock data layer provides this (`provideMockData()`). With the HTTP
 * data layer it isn't provided, so every prototype control disappears — no
 * build flag to remember. Inject it optionally:
 *
 *   protected readonly prototype = inject(PrototypeControls, { optional: true });
 */
export abstract class PrototypeControls {
  /** Forget which Smart Nudges were seen or dismissed, so a reviewer can see them again. */
  abstract resetNudges(): void;
  /** When the simulated data was last saved in this browser (development only), or null. */
  abstract lastSaved(): string | null;
  /** Throw away everything created or changed in the simulation and start again from the seed data. */
  abstract resetSimulation(): void;
  /** Simulate an invited person accepting their invitation (in reality: they follow the email link and set up a passkey). */
  abstract acceptInvite(identityId: string): void;
  /** The last sign-in link "emailed" (nothing is really sent), so a presenter can open it. `delivered`: false when no account has that address. */
  abstract lastSignInLink(): { email: string; token: string; code: string; delivered: boolean } | null;
}
