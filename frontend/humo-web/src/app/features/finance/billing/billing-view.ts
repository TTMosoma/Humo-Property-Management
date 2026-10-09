import { BILLING_STAGES, BILLING_STAGE_LABELS, BillingStage, ChargeKind } from '../../../domain';
import { StageDef } from '../../../ui/stage-tracker/stage-tracker';
import { Tone } from '../../../ui/status-pill/status-pill';

export const BILLING_TRACKER: StageDef[] = BILLING_STAGES.map((s) => ({ id: s.id, label: s.label }));

export const BILLING_STAGE_TONE: Record<BillingStage, Tone> = {
  preview: 'accent',
  'awaiting-approval': 'warning',
  approved: 'info',
  posted: 'info',
  sent: 'success',
  cancelled: 'neutral',
};

export const billingStageLabel = (s: BillingStage) => BILLING_STAGE_LABELS[s];

export const CHARGE_LABELS: Record<ChargeKind, string> = {
  levy: 'Levy',
  'special-levy': 'Special levy',
  utility: 'Water',
  interest: 'Interest',
};
