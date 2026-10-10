import { ComplianceStatus, HealthRating, Scheme, SchemeHealth } from '../../domain';
import { Tone } from '../../ui/status-pill/status-pill';

export interface SchemeRow {
  scheme: Scheme;
  health: SchemeHealth;
  manager: string;
}

export const RATING: Record<HealthRating, { label: string; tone: Tone }> = {
  good: { label: 'Healthy', tone: 'success' },
  watch: { label: 'Watch', tone: 'warning' },
  'at-risk': { label: 'At risk', tone: 'danger' },
};

export const COMPLIANCE: Record<ComplianceStatus, { label: string; tone: Tone }> = {
  complete: { label: 'Complete', tone: 'success' },
  upcoming: { label: 'Upcoming', tone: 'info' },
  'due-soon': { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  'not-applicable': { label: 'Not applicable', tone: 'neutral' },
};

export function toRows(schemes: Scheme[], health: SchemeHealth[]): SchemeRow[] {
  const byId = new Map(health.map((h) => [h.schemeId, h]));
  return schemes
    .filter((s) => byId.has(s.id))
    .map((scheme) => ({ scheme, health: byId.get(scheme.id)!, manager: scheme.portfolioManager?.name ?? 'Unassigned' }));
}

export function collectionTone(rate: number): 'success' | 'warning' | 'danger' {
  return rate >= 91 ? 'success' : rate >= 85 ? 'warning' : 'danger';
}
