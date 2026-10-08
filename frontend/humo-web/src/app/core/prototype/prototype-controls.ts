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
}
