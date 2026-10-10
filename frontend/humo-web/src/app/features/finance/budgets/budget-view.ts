import { BudgetStatus } from '../../../domain';
import { Tone } from '../../../ui/status-pill/status-pill';

export const BUDGET_TONE: Record<BudgetStatus, Tone> = { draft: 'neutral', proposed: 'info', approved: 'success' };
