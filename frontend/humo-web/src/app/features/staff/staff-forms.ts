import { StaffDataSource, StaffSummary } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { openForm, today } from '../shared/form-drawer';

/** Away cover: their open Tasks and messages move to a colleague, and new work for their schemes goes there too. */
export function coverForm(drawer: DrawerService, data: StaffDataSource, s: StaffSummary, team: StaffSummary[]): void {
  const colleagues = team.filter((t) => t.id !== s.id && !t.away);
  openForm(drawer, {
    eyebrow: s.name,
    title: `${s.name.split(' ')[0]} is away`,
    intro: `From the first day, ${s.openTasks + s.openMessages} open Task${s.openTasks + s.openMessages === 1 ? '' : 's'} and message${s.openTasks + s.openMessages === 1 ? '' : 's'} move to the colleague you choose, and new work for ${s.allSchemes ? 'the agency' : `their ${s.schemes.length} scheme${s.schemes.length === 1 ? '' : 's'}`} goes to them too. When it ends, what’s still open moves back. Approvals don’t move: anyone with the right role can decide them.`,
    fields: [
      { key: 'coverId', label: 'Covered by', type: 'select', required: true, options: colleagues.map((c) => ({ value: c.id, label: `${c.name} · ${c.openTasks} open` })) },
      { key: 'from', label: 'First day away', type: 'date', required: true, half: true },
      { key: 'to', label: 'Last day away', type: 'date', required: true, half: true },
      { key: 'reason', label: 'Why', type: 'text', required: true, placeholder: 'Leave, training, sick…', help: 'Shown to the team.' },
    ],
    initial: { coverId: colleagues.sort((a, b) => a.openTasks - b.openTasks)[0]?.id ?? '', from: today(), to: today(), reason: 'Leave' },
    submitLabel: 'Set cover',
    submit: (v) => data.setCover(s.id, { coverId: v['coverId'], from: v['from'], to: v['to'], reason: v['reason'] }),
    success: () => 'Cover set.',
    failure: 'The cover wasn’t set',
  });
}
