import { HealthBand, SubscriptionStatus } from '../../domain';

export const BAND_LABEL: Record<HealthBand, string> = { healthy: 'Healthy', 'at-risk': 'At risk', critical: 'Critical' };
export const BAND_TONE: Record<HealthBand, 'success' | 'warning' | 'danger'> = { healthy: 'success', 'at-risk': 'warning', critical: 'danger' };

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: 'Trial',
  active: 'Active',
  'past-due': 'Payment overdue',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};
export const STATUS_TONE: Record<SubscriptionStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  trial: 'info',
  active: 'success',
  'past-due': 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
};

/** Package and add-on names, module rows: see CatalogueService. */
