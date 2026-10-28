import { CHANNEL_LABELS, DeliveryStatus, MERGE_FIELDS, SentView } from '../../domain';
import { formatDate } from '../../ui/format/money';
import { Tone } from '../../ui/status-pill/status-pill';

export const DELIVERY_TONE: Record<DeliveryStatus, Tone> = {
  scheduled: 'info',
  queued: 'neutral',
  delivered: 'success',
  read: 'success',
  failed: 'danger',
  bounced: 'danger',
};

/** One pill and one line for a sent message: "Delivered · 61 of 64, 3 bounced". */
export function deliverySummary(v: SentView): { label: string; tone: Tone; detail: string } {
  const c = v.counts;
  const total = v.message.deliveries.length;
  const problems = c.failed + c.bounced;
  if (v.state === 'cancelled') return { label: 'Cancelled', tone: 'neutral', detail: `${total} not sent` };
  if (v.state === 'scheduled') return { label: 'Scheduled', tone: 'info', detail: `${total} people · ${formatDate(v.message.sendAt, true)}` };
  const ok = c.delivered + c.read;
  // Email, SMS and (later) WhatsApp report back separately: show each channel's own result.
  const byChannel = [...new Set(v.message.deliveries.map((d) => d.channel))].map((ch) => {
    const ds = v.message.deliveries.filter((d) => d.channel === ch);
    const arrived = ds.filter((d) => d.status === 'delivered' || d.status === 'read').length;
    const waiting = ds.filter((d) => d.status === 'queued').length;
    const notDelivered = ds.filter((d) => d.status === 'failed' || d.status === 'bounced').length;
    return `${CHANNEL_LABELS[ch]} ${arrived} of ${ds.length}${waiting ? `, ${waiting} waiting` : ''}${notDelivered ? `, ${notDelivered} not delivered` : ''}`;
  });
  return {
    label: problems ? `${problems} not delivered` : c.queued ? 'Waiting for delivery reports' : 'Delivered',
    tone: problems ? 'warning' : c.queued ? 'info' : 'success',
    detail: `${byChannel.join(' · ') || `${ok} of ${total} arrived`}${c.read ? ` · ${c.read} read` : ''}${v.message.skipped.length ? ` · ${v.message.skipped.length} unreachable` : ''}`,
  };
}

/**
 * A subject for lists and headers: shared fields filled in (scheme, agency),
 * per-person ones shown as what they are ("‹account number›").
 */
export function displaySubject(v: SentView): string {
  const shared = v.message.deliveries[0]?.values ?? {};
  const s = v.message.subject.replace(/\{([a-z]+)\.([a-zA-Z]+)\}/g, (m, scope: string, key: string) => {
    if (scope === 'scheme' || scope === 'agency') return shared[`${scope}.${key}`] ?? (scope === 'scheme' ? v.scheme.name : m);
    const field = MERGE_FIELDS.find((f) => f.key === `${scope}.${key}`);
    return field ? `‹${field.label.toLowerCase()}›` : m;
  });
  return s || '(no subject)';
}
