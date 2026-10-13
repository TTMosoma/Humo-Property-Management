import { Injectable } from '@angular/core';
import { PolicyDenial } from '../../domain';

const MESSAGES: Record<PolicyDenial, string> = {
  'observe-only': 'Observe mode is read-only. Nothing was changed — the attempt was logged.',
  forbidden: 'Your current role doesn’t allow this. Nothing was changed.',
  'step-up-required': 'This needs additional verification first. Nothing was changed.',
  'not-entitled': 'Your agency’s plan doesn’t include this feature.',
  'out-of-scope': 'That scheme isn’t one of yours: you can look, but not change anything. Nothing was changed.',
};

/**
 * The equivalent of an HTTP interceptor for 403 responses: when the API refuses
 * a command on policy grounds, feature code's generic "couldn’t save" message
 * is replaced by the actual reason (see FeedbackService.error).
 */
@Injectable({ providedIn: 'root' })
export class PolicyNotices {
  private last: { code: PolicyDenial; at: number } | null = null;

  report(code: PolicyDenial): void {
    this.last = { code, at: Date.now() };
  }

  /** The policy reason for an error that happened in the last couple of seconds, once. */
  consume(): string | null {
    const l = this.last;
    this.last = null;
    return l && Date.now() - l.at < 2500 ? MESSAGES[l.code] : null;
  }
}
