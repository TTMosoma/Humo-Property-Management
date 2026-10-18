import { BoardCandidate, BoardDataSource, BoardView, ResolutionView, TRUSTEE_PORTFOLIOS, TrusteeView, todaySA } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { openForm } from '../shared/form-drawer';

const today = () => todaySA();
const PORTFOLIO_OPTIONS = TRUSTEE_PORTFOLIOS.map((p) => ({ value: p, label: p }));

export const resolutionOptions = (rs: ResolutionView[]) =>
  rs
    .filter((r) => r.resolution.outcome === 'passed')
    .sort((a, b) => (b.resolution.decidedAt ?? '').localeCompare(a.resolution.decidedAt ?? ''))
    .map((r) => ({ value: r.resolution.id, label: `${r.resolution.ref} · ${r.resolution.title}` }));

export function appointForm(drawer: DrawerService, data: BoardDataSource, b: BoardView, candidates: BoardCandidate[], resolutions: ResolutionView[]): void {
  openForm(drawer, {
    eyebrow: `${b.scheme.name} · Trustee board`,
    title: 'Add a trustee',
    intro: 'Trustees are elected by the owners at a general meeting. Between AGMs the board can co-opt an owner to fill a vacancy until the next AGM.',
    fields: [
      { key: 'personId', label: 'Owner', type: 'select', required: true, options: candidates.map((c) => ({ value: c.personId, label: `${c.name} · ${c.units.join(', ')}` })), help: 'Owners of units in this scheme who aren’t on the board.' },
      { key: 'portfolio', label: 'Portfolio', type: 'select', required: true, half: true, options: PORTFOLIO_OPTIONS },
      { key: 'since', label: 'From', type: 'date', required: true, half: true },
      {
        key: 'how',
        label: 'How',
        type: 'select',
        required: true,
        options: [
          { value: 'elected', label: 'Elected by the owners (resolution)' },
          { value: 'co-opted', label: 'Co-opted by the board until the next AGM' },
        ],
      },
      { key: 'resolutionId', label: 'Resolution', type: 'select', required: true, options: resolutionOptions(resolutions), showIf: (v) => v['how'] === 'elected',
        help: resolutionOptions(resolutions).length ? 'The passed resolution that elected them.' : 'No passed resolutions at this scheme yet: record the election at its meeting first, or co-opt them until the AGM.',
      },
    ],
    initial: { portfolio: 'Trustee', since: today(), how: b.nextAgm ? 'co-opted' : 'elected' },
    submitLabel: 'Add to the board',
    submit: (v) => data.act(b.scheme.id, { type: 'appoint', personId: v['personId'], portfolio: v['portfolio'], how: v['how'] as 'elected' | 'co-opted', since: v['since'], resolutionId: v['how'] === 'elected' ? v['resolutionId'] : undefined }),
    success: () => 'Added to the board. Quorum and approvals now count them.',
    failure: 'They weren’t added',
  });
}

export function endTermForm(drawer: DrawerService, data: BoardDataSource, b: BoardView, t: TrusteeView): void {
  openForm(drawer, {
    eyebrow: `${b.scheme.name} · Trustee board`,
    title: `${t.person.displayName} leaves the board`,
    intro:
      b.trustees.length - 1 < b.minimum
        ? `The board will have ${b.trustees.length - 1} trustees, below its minimum of ${b.minimum}. Compliance will show it until the vacancy is filled.`
        : 'Their trustee access in Humo Property Management ends too. Their history stays on the board’s record.',
    fields: [
      { key: 'on', label: 'Leaves on', type: 'date', required: true, half: true },
      {
        key: 'reason',
        label: 'Why',
        type: 'select',
        required: true,
        half: true,
        options: ['Resigned', 'Sold their unit', 'Not re-elected at the AGM', 'Removed at a general meeting', 'Passed away', 'Other'].map((x) => ({ value: x, label: x })),
      },
    ],
    initial: { on: today(), reason: 'Resigned' },
    submitLabel: 'End their term',
    submit: (v) => data.act(b.scheme.id, { type: 'end', relationshipId: t.relationship.id, on: v['on'], reason: v['reason'] }),
    success: () => `${t.person.displayName} is no longer a trustee.`,
    failure: 'Their term wasn’t ended',
  });
}

export function portfolioForm(drawer: DrawerService, data: BoardDataSource, b: BoardView, t: TrusteeView): void {
  openForm(drawer, {
    eyebrow: `${b.scheme.name} · Trustee board`,
    title: `${t.person.displayName}’s portfolio`,
    fields: [{ key: 'portfolio', label: 'Portfolio', type: 'select', required: true, options: PORTFOLIO_OPTIONS }],
    initial: { portfolio: t.relationship.portfolio ?? 'Trustee' },
    submitLabel: 'Save',
    submit: (v) => data.act(b.scheme.id, { type: 'set-portfolio', relationshipId: t.relationship.id, portfolio: v['portfolio'] }),
    success: () => 'Saved.',
    failure: 'It wasn’t saved',
  });
}

export function minimumForm(drawer: DrawerService, data: BoardDataSource, b: BoardView): void {
  openForm(drawer, {
    eyebrow: `${b.scheme.name} · Trustee board`,
    title: 'Board size',
    intro: 'The fewest trustees the scheme’s rules allow. Compliance flags the board when it falls below this.',
    fields: [{ key: 'minimum', label: 'Minimum trustees', type: 'number', required: true, half: true }],
    initial: { minimum: String(b.minimum) },
    submitLabel: 'Save',
    submit: (v) => data.act(b.scheme.id, { type: 'set-minimum', minimum: Number(v['minimum']) }),
    success: () => 'Saved.',
    failure: 'It wasn’t saved',
  });
}
