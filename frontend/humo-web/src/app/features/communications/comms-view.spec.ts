import { Delivery, DeliveryStatus, SentView } from '../../domain';
import { deliverySummary } from './comms-view';

/** A sent message with these deliveries (only what the summary reads). */
function sent(deliveries: Pick<Delivery, 'channel' | 'status'>[]): SentView {
  const counts = { scheduled: 0, queued: 0, delivered: 0, read: 0, failed: 0, bounced: 0 } as Record<DeliveryStatus, number>;
  for (const d of deliveries) counts[d.status]++;
  return { state: 'sending', counts, message: { deliveries, skipped: [] } } as unknown as SentView;
}

describe('deliverySummary', () => {
  it('waits for delivery reports instead of claiming delivery, channel by channel', () => {
    const s = deliverySummary(sent([{ channel: 'email', status: 'delivered' }, { channel: 'sms', status: 'queued' }]));
    expect(s.label).toBe('Waiting for delivery reports');
    expect(s.tone).toBe('info');
    expect(s.detail).toBe('Email 1 of 1 · SMS 0 of 1, 1 waiting');
  });

  it('is delivered once every report is in', () => {
    const s = deliverySummary(sent([{ channel: 'email', status: 'delivered' }, { channel: 'sms', status: 'delivered' }]));
    expect([s.label, s.tone]).toEqual(['Delivered', 'success']);
  });

  it('names what didn’t arrive', () => {
    const s = deliverySummary(sent([{ channel: 'sms', status: 'failed' }, { channel: 'sms', status: 'delivered' }]));
    expect(s.label).toBe('1 not delivered');
    expect(s.detail).toBe('SMS 1 of 2, 1 not delivered');
  });
});
