import { COLLECTION_STAGES, COLLECTION_STAGE_LABELS, CollectionStage, CollectionView, LetterKind } from '../../../domain';
import { StageDef } from '../../../ui/stage-tracker/stage-tracker';
import { Tone } from '../../../ui/status-pill/status-pill';

export const COLLECTION_TRACKER: StageDef[] = COLLECTION_STAGES.map((s) => ({ id: s.id, label: s.label }));

export const COLLECTION_STAGE_TONE: Record<CollectionStage, Tone> = {
  'not-started': 'neutral',
  reminder: 'info',
  'final-demand': 'warning',
  'letter-of-demand': 'danger',
  'handed-over': 'danger',
  arrangement: 'accent',
  disputed: 'warning',
};

export const collectionStageLabel = (s: CollectionStage) => COLLECTION_STAGE_LABELS[s];

export const LETTER_LABELS: Record<LetterKind, string> = {
  reminder: 'Reminder',
  'final-demand': 'Final demand',
  'letter-of-demand': 'Letter of demand',
};

/** The letter that moves the case on from this stage, if any. */
export function nextLetter(v: CollectionView): LetterKind | undefined {
  const c = v.case;
  if (c.stage === 'not-started') return 'reminder';
  if (c.stage === 'reminder') return 'final-demand';
  if (c.stage === 'final-demand' && c.demandApproval?.status === 'approved') return 'letter-of-demand';
  return undefined;
}
