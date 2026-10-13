/**
 * Every failure a data source can report, whatever the transport. The HTTP
 * adapters map responses onto it (ProblemDetails from the .NET API):
 *
 *   400 / 422 → validation  (fieldErrors: which field, what's wrong)
 *   401 / 403 → policy      (PolicyError: why it was refused)
 *   404       → not-found
 *   409 / 412 → conflict    (someone else changed it first)
 *   0 / 5xx   → network / server
 *
 * Forms keep what the person typed on any failure and show field errors next to
 * the fields; everything else becomes one plain sentence.
 */
export type ApiErrorKind = 'validation' | 'policy' | 'not-found' | 'conflict' | 'network' | 'server';

/** Field name → what's wrong with it, in words the person can act on. */
export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Why the API refused a command. The UI hides what a person can't do, but the
 * API is the security boundary: it re-checks role permissions, scope,
 * entitlements, impersonation mode and step-up freshness on every command.
 */
export type PolicyDenial = 'observe-only' | 'forbidden' | 'step-up-required' | 'not-entitled' | 'out-of-scope';

export class PolicyError extends ApiError {
  constructor(
    readonly code: PolicyDenial,
    message: string,
  ) {
    super('policy', message);
    this.name = 'PolicyError';
  }
}

/** Anything thrown or emitted as an error, as an ApiError (unknown errors count as network failures). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError('network', error instanceof Error ? error.message : 'The request failed');
}

/** Field errors from a failed request ({} when the failure wasn't about the input). */
export function fieldErrorsOf(error: unknown): FieldErrors {
  return error instanceof ApiError && error.kind === 'validation' ? error.fieldErrors : {};
}

/**
 * One sentence for a toast. `action` is what was being attempted, e.g.
 * "The role wasn’t granted". Policy refusals are explained by PolicyNotices.
 */
export function describeFailure(error: unknown, action: string): string {
  const e = toApiError(error);
  switch (e.kind) {
    case 'validation':
      return `${action}. Check the highlighted fields.`;
    case 'conflict':
      return `${action}: someone else changed it a moment ago. Reload to see their change, then try again.`;
    case 'not-found':
      return `${action}: it no longer exists.`;
    case 'policy':
      return `${action}. ${e.message}.`;
    case 'server':
      return `${action}. Something went wrong on our side; nothing was changed.`;
    default:
      return `${action}. Check your connection and try again; nothing was changed.`;
  }
}
