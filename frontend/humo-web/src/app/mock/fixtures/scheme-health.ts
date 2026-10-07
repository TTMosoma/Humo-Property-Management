import { ComplianceStatus, HealthRating, SchemeHealth } from '../../domain';
import { SCHEMES } from './schemes';

/** Deterministic pseudo-random numbers per scheme, so figures are stable across reloads. */
function seeded(id: string): () => number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

/** Hand-tuned values for schemes that appear in the demo story. */
const OVERRIDES: Record<string, Partial<SchemeHealth>> = {
  'kingfisher-court': { collectionRate: 93.4, arrears: 186420.35, accounts90Plus: 3, openJobs: 9, overdueJobs: 1, compliance: 'due-soon', complianceOpenItems: 1, nextMeeting: { type: 'Trustee meeting', at: daysFromNow(9) } },
  'silverlakes-manor': { collectionRate: 81.2, compliance: 'overdue', complianceOpenItems: 2 },
  'ballito-dunes': { compliance: 'overdue', complianceOpenItems: 1 },
  'jacaranda-heights': { compliance: 'due-soon', complianceOpenItems: 1 },
  'benoni-lakeside': { overdueJobs: 1, collectionRate: 84.9 },
  'northcliff-view': { overdueJobs: 1 },
  'centurion-palms': { overdueJobs: 1 },
  'the-willows': { openJobs: 6 },
};

export const SCHEME_HEALTH: SchemeHealth[] = SCHEMES.map((s) => {
  const r = seeded(s.id);
  const avgLevy = 1450 + Math.round(r() * 5450);
  const monthlyLevyRoll = avgLevy * s.unitCount;
  const collectionRate = Math.round((89.5 + r() * 9.5) * 10) / 10;
  const arrears = Math.round(monthlyLevyRoll * (1 - collectionRate / 100) * (2.2 + r() * 2) * 100) / 100;
  const openJobs = Math.round(r() * Math.max(3, s.unitCount / 8));
  const compliancePick = r();
  const compliance: ComplianceStatus = compliancePick > 0.88 ? 'due-soon' : 'complete';

  const base: SchemeHealth = {
    schemeId: s.id,
    collectionRate,
    arrears,
    accounts90Plus: Math.round(r() * 4),
    monthlyLevyRoll,
    openJobs,
    overdueJobs: 0,
    compliance,
    complianceOpenItems: compliance === 'complete' ? 0 : 1,
    nextMeeting: r() > 0.5 ? { type: r() > 0.8 ? 'AGM' : 'Trustee meeting', at: daysFromNow(3 + Math.round(r() * 40)) } : undefined,
    rating: 'good',
  };
  const merged = { ...base, ...OVERRIDES[s.id] };
  merged.rating = rate(merged);
  return merged;
});

function rate(h: SchemeHealth): HealthRating {
  if (h.compliance === 'overdue' || h.collectionRate < 85 || (h.overdueJobs > 0 && h.collectionRate < 90)) return 'at-risk';
  if (h.compliance === 'due-soon' || h.collectionRate < 91 || h.overdueJobs > 0) return 'watch';
  return 'good';
}
