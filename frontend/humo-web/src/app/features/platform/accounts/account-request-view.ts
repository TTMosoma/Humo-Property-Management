import { AccountRequest } from '../../../domain';
import { Tone } from '../../../ui/status-pill/status-pill';

/** Waiting is amber, rejected red; approved green; delegated activation stands out for oversight. */
export const REQUEST_TONE = (r: AccountRequest): Tone => (r.status === 'pending' ? 'warning' : r.status === 'rejected' ? 'danger' : r.route === 'delegated' ? 'accent' : 'success');
