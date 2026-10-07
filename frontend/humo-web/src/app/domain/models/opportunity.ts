import { AccountHealth, UsageSnapshot } from './account-health';
import { AddOnId, EntitlementSet, PackageId, Subscription } from './entitlement';

/**
 * Opportunities: evidence that a customer would get more value from Humo.
 *
 * One set of rules feeds two audiences:
 *  - Account Managers see opportunities with their reasons (a reason to call).
 *  - Smart Nudges reference the same rule ids (a quiet in-product suggestion).
 *
 * "Adoption" opportunities are deliberately not sales: they flag paid-for
 * features a customer isn't using, which is a training conversation.
 */
export type OpportunityKind = 'add-on' | 'package' | 'adoption';
export type OpportunityStrength = 'high' | 'medium' | 'low';
export type OpportunityRuleId = 'governance-addon' | 'advanced-reporting-addon' | 'professional-upgrade' | 'underused-feature';

export interface Opportunity {
  id: string;
  agencyId: string;
  rule: OpportunityRuleId;
  kind: OpportunityKind;
  title: string;
  target: { addOn?: AddOnId; package?: PackageId; module?: string };
  strength: OpportunityStrength;
  reasons: string[];
  /** Mock indicative value per month — for prioritisation only, not a quote. */
  potentialMrr: number;
}

export interface OpportunityContext {
  snapshot: UsageSnapshot;
  entitlements: EntitlementSet;
  subscription: Subscription;
  health: AccountHealth;
}

export interface OpportunityRule {
  id: OpportunityRuleId;
  description: string;
  detect(ctx: OpportunityContext): Omit<Opportunity, 'id' | 'agencyId' | 'rule'> | null;
}

export const OPPORTUNITY_RULES: OpportunityRule[] = [
  {
    id: 'governance-addon',
    description: 'Governance off AND more than 5 trustees AND regular meetings AND governance-like activity elsewhere',
    detect: ({ snapshot: s, entitlements: e, health }) => {
      // Demand: trustee approvals, minutes uploaded as documents, meeting tasks — without the module.
      const demand = health.modules.find((m) => m.module === 'governance')?.adoption ?? 0;
      if (e.has('governance') || s.trustees <= 5 || s.meetingsPerYear < 6 || demand < 8) return null;
      const strength: OpportunityStrength = s.trustees >= 8 && s.meetingsPerYear >= 12 && demand >= 10 ? 'high' : 'medium';
      return {
        kind: 'add-on', title: 'Governance', target: { addOn: 'governance' }, strength,
        reasons: [`${s.trustees} trustees`, `${s.meetingsPerYear} meetings a year`, 'Governance not enabled'],
        potentialMrr: Math.round(900 + s.schemes * 45),
      };
    },
  },
  {
    id: 'advanced-reporting-addon',
    description: 'Advanced reporting off AND frequent exports AND strong finance use',
    detect: ({ snapshot: s, entitlements: e, health }) => {
      const finance = health.modules.find((m) => m.module === 'finance')?.adoption ?? 0;
      if (e.has('reporting-advanced') || s.reportExports30d < 10 || finance < 70) return null;
      return {
        kind: 'add-on', title: 'Advanced Reporting', target: { addOn: 'advanced-reporting' }, strength: s.reportExports30d >= 30 ? 'high' : 'medium',
        reasons: [`${s.reportExports30d} report exports this month`, `Finance adoption ${finance}%`],
        potentialMrr: Math.round(650 + s.schemes * 25),
      };
    },
  },
  {
    id: 'professional-upgrade',
    description: 'Essentials AND sizeable portfolio AND heavy manual receipting',
    detect: ({ snapshot: s, subscription }) => {
      if (subscription.packageId !== 'essentials' || s.units < 600) return null;
      return {
        kind: 'package', title: 'Humo Professional', target: { package: 'professional' }, strength: s.units > 1000 ? 'high' : 'medium',
        reasons: [`${s.units.toLocaleString('en-ZA')} units on Essentials`, `${s.receiptsAllocated30d} receipts handled outside Humo`],
        potentialMrr: Math.round(s.units * 4.5),
      };
    },
  },
  {
    id: 'underused-feature',
    description: 'An enabled module used below 25% — a training conversation, not a sale',
    detect: ({ health }) => {
      const low = health.modules.filter((m) => m.enabled && m.adoption < 25 && m.module !== 'compliance');
      if (!low.length) return null;
      return {
        kind: 'adoption', title: `Help them use ${low.map((m) => m.module).join(', ')}`, target: { module: low[0].module }, strength: 'low',
        reasons: low.map((m) => `${m.module}: ${m.adoption}% adoption`),
        potentialMrr: 0,
      };
    },
  },
];

export function detectOpportunities(ctx: OpportunityContext, rules = OPPORTUNITY_RULES): Opportunity[] {
  return rules
    .map((r) => {
      const found = r.detect(ctx);
      return found ? { ...found, id: `${ctx.subscription.agencyId}:${r.id}`, agencyId: ctx.subscription.agencyId, rule: r.id } : null;
    })
    .filter((o): o is Opportunity => !!o);
}

/** Where a customer asked for something themselves (from a nudge or the Plan page). */
export interface UpgradeRequest {
  id: string;
  agencyId: string;
  addOn?: AddOnId;
  package?: PackageId;
  requestedBy: string;
  at: string;
  note?: string;
  source: 'nudge' | 'plan-page';
  status: 'new' | 'in-progress' | 'done' | 'declined';
}
