import { Router } from '@angular/router';
import { BreachView, RULE_CATEGORY_LABELS, ResolutionView, RuleCategory, RulesDataSource, RulesView, SchemeRule, UnitSummary, warningLetter } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { openForm } from '../shared/form-drawer';
import { resolutionOptions } from './board-forms';

const today = () => new Date().toISOString().slice(0, 10);
const CATEGORY_OPTIONS = (Object.keys(RULE_CATEGORY_LABELS) as RuleCategory[]).map((c) => ({ value: c, label: RULE_CATEGORY_LABELS[c] }));

/**
 * The scheme's registered rules as a PDF: the official document, kept with its
 * history. Owners and residents see it when it's shared. Individual rules you
 * enforce still go in the register (breaches cite a rule).
 */
export function uploadRulesForm(drawer: DrawerService, data: RulesDataSource, v: RulesView): void {
  const current = v.book.sources?.[0];
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · Scheme rules`,
    title: current ? 'Upload new registered rules' : 'Upload the registered rules',
    intro: current
      ? `It replaces the rules in force from ${formatDate(current.adoptedOn)}. That PDF stays on record. Upload a new version only once the owners have adopted it.`
      : 'The scheme’s conduct rules as registered, as a PDF. Add the rules you enforce to the register too, so breaches can cite them.',
    fields: [
      { key: 'file', label: 'Rules PDF', type: 'file', required: true, accept: 'application/pdf,.pdf' },
      { key: 'adoptedOn', label: 'In force from', type: 'date', required: true, half: true },
      {
        key: 'share',
        label: 'Owners and residents',
        type: 'select',
        required: true,
        half: true,
        options: [
          { value: 'yes', label: 'Share it with them' },
          { value: 'no', label: 'Staff only for now' },
        ],
      },
      { key: 'resolutionRef', label: 'How they were adopted', type: 'text', required: true, placeholder: 'e.g. Registered with the CSOS, or AGM 2024 special resolution RES-KC-14' },
    ],
    initial: { adoptedOn: today(), share: 'yes' },
    submitLabel: 'Upload rules',
    submit: (f, files) =>
      data.actRules(
        v.scheme.id,
        {
          type: 'upload',
          fileName: f['file'],
          mimeType: files['file']?.type ?? '',
          sizeBytes: files['file']?.size ?? 0,
          adoptedOn: f['adoptedOn'],
          resolutionRef: f['resolutionRef'],
          shareWithOwners: f['share'] === 'yes',
        },
        files['file'],
      ),
    success: (_r, f) => (f['share'] === 'yes' ? 'Uploaded and shared: owners and residents see the rules in their documents.' : 'Uploaded. Only staff can see it until you share it.'),
    failure: 'The rules weren’t uploaded',
  });
}

export function addRuleForm(drawer: DrawerService, data: RulesDataSource, v: RulesView, resolutions: ResolutionView[]): void {
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · Scheme rules`,
    title: 'Add a rule',
    intro: 'A new rule is adopted by resolution of the owners. When capturing a scheme’s registered rules for the first time, leave the resolution empty.',
    fields: [
      { key: 'number', label: 'Number', type: 'text', required: true, half: true, placeholder: '4.3' },
      { key: 'category', label: 'Category', type: 'select', required: true, half: true, options: CATEGORY_OPTIONS },
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Electric vehicle charging' },
      { key: 'text', label: 'Wording', type: 'textarea', required: true },
      { key: 'resolutionId', label: 'Adopted by', type: 'select', options: [{ value: '', label: 'Captured from the registered rules' }, ...resolutionOptions(resolutions)] },
    ],
    initial: { category: 'other', resolutionId: '' },
    submitLabel: 'Add the rule',
    submit: (f) => data.actRules(v.scheme.id, { type: 'add', number: f['number'], title: f['title'], category: f['category'] as RuleCategory, text: f['text'], resolutionId: f['resolutionId'] }),
    success: () => 'Rule added. Share the rule book so owners have the current version.',
    failure: 'The rule wasn’t added',
  });
}

export function amendRuleForm(drawer: DrawerService, data: RulesDataSource, v: RulesView, rule: SchemeRule, resolutions: ResolutionView[]): void {
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · Rule ${rule.number}`,
    title: `Amend: ${rule.title}`,
    intro: 'Conduct rules change by special resolution of the owners. The earlier wording stays in the rule’s history.',
    fields: [
      { key: 'text', label: 'New wording', type: 'textarea', required: true },
      { key: 'resolutionId', label: 'Resolution', type: 'select', required: true, options: resolutionOptions(resolutions) },
    ],
    initial: { text: rule.versions[0].text },
    submitLabel: 'Amend the rule',
    submit: (f) => data.actRules(v.scheme.id, { type: 'amend', ruleId: rule.id, text: f['text'], resolutionId: f['resolutionId'] }),
    success: () => 'Amended. Share the rule book so owners have the current version.',
    failure: 'The rule wasn’t amended',
  });
}

export function repealRuleForm(drawer: DrawerService, data: RulesDataSource, v: RulesView, rule: SchemeRule, resolutions: ResolutionView[]): void {
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · Rule ${rule.number}`,
    title: `Repeal: ${rule.title}`,
    intro: 'It stays in the register as repealed, with its history.',
    fields: [{ key: 'resolutionId', label: 'Resolution', type: 'select', required: true, options: resolutionOptions(resolutions) }],
    submitLabel: 'Repeal the rule',
    submit: (f) => data.actRules(v.scheme.id, { type: 'repeal', ruleId: rule.id, resolutionId: f['resolutionId'] }),
    success: () => 'Repealed.',
    failure: 'The rule wasn’t repealed',
  });
}

export function logBreachForm(drawer: DrawerService, data: RulesDataSource, router: Router, v: RulesView, units: UnitSummary[], ruleId?: string): void {
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · Breach log`,
    title: 'Log a breach',
    intro: 'Record what was reported. Nothing is sent yet: the warning letter is the next step, from the breach.',
    fields: [
      { key: 'ruleId', label: 'Rule', type: 'select', required: true, options: v.rules.filter((r) => r.status === 'in-force').map((r) => ({ value: r.id, label: `${r.number} ${r.title}` })) },
      { key: 'unitId', label: 'Unit', type: 'select', required: true, half: true, options: units.map((u) => ({ value: u.unit.id, label: `${u.unit.accountNo} · ${u.owners[0]?.displayName ?? '—'}` })) },
      {
        key: 'against',
        label: 'Letters to',
        type: 'select',
        required: true,
        half: true,
        optionsFor: (f) => {
          const u = units.find((x) => x.unit.id === f['unitId']);
          return [{ value: 'owner', label: `The owner${u?.owners[0] ? ` (${u.owners[0].displayName})` : ''}` }, ...(u?.tenant ? [{ value: 'tenant', label: `The tenant (${u.tenant.displayName})` }] : [])];
        },
      },
      { key: 'occurredAt', label: 'When', type: 'date', required: true, half: true },
      { key: 'description', label: 'What happened', type: 'textarea', required: true, help: 'What was seen or heard, where and when, and who reported it.' },
    ],
    initial: { ruleId: ruleId ?? '', against: 'owner', occurredAt: today() },
    submitLabel: 'Log it',
    submit: (f) => data.logBreach({ schemeId: v.scheme.id, ruleId: f['ruleId'], unitId: f['unitId'], against: f['against'] as 'owner' | 'tenant', description: f['description'], occurredAt: f['occurredAt'] }),
    success: () => 'Logged.',
    done: (id) => router.navigate(['/governance/rules/breaches', id]),
    failure: 'It wasn’t logged',
  });
}

export function warnForm(drawer: DrawerService, data: RulesDataSource, b: BreachView, final: boolean): void {
  const what = b.breach.description.replace(/\.$/, '');
  openForm(drawer, {
    eyebrow: `${b.breach.ref} · Unit ${b.unit.number}`,
    title: final ? 'Send a final warning' : 'Send a warning',
    intro: `To ${b.person.displayName} (${b.personRole}). A Task reminds you to check on the date you give. Humo Property Management doesn’t levy fines: if it isn’t put right, refer it to the trustees.`,
    fields: [
      { key: 'remedyDays', label: 'Days to put it right', type: 'number', required: true, half: true },
      { key: 'channel', label: 'Send by', type: 'select', required: true, half: true, options: [{ value: 'email', label: 'Email' }, { value: 'post', label: 'Post (print and record)' }] },
      { key: 'message', label: 'Letter', type: 'textarea', required: true },
    ],
    initial: {
      remedyDays: final ? '7' : '14',
      channel: b.person.email ? 'email' : 'post',
      message: warningLetter(b.person.displayName, b.rule.number, b.rule.title, `the following: ${what.charAt(0).toLowerCase()}${what.slice(1)}`, final),
    },
    submitLabel: final ? 'Send final warning' : 'Send warning',
    submit: (f) => data.actBreach(b.breach.id, { type: 'warn', final, remedyDays: Number(f['remedyDays']), channel: f['channel'] as 'email' | 'post', message: f['message'] }, b.breach.version),
    success: (_, f) => (f['channel'] === 'email' ? 'Sent. It’s in Communications › Sent.' : 'Recorded. Print and post the letter.'),
    failure: 'It wasn’t sent',
  });
}

export function breachNoteForm(drawer: DrawerService, data: RulesDataSource, b: BreachView, kind: 'note' | 'refer' | 'resolve' | 'reopen'): void {
  const spec = {
    note: { title: 'Add a note', label: 'Note', submit: 'Add note', done: 'Note added.' },
    refer: { title: 'Refer to the trustees', label: 'For the trustees', submit: 'Refer', done: 'Referred: the trustees have a Task to decide.' },
    resolve: { title: 'Resolve', label: 'How it was resolved', submit: 'Resolve', done: 'Resolved.' },
    reopen: { title: 'Reopen', label: 'Why', submit: 'Reopen', done: 'Reopened.' },
  }[kind];
  openForm(drawer, {
    eyebrow: `${b.breach.ref} · Unit ${b.unit.number}`,
    title: spec.title,
    intro:
      kind === 'refer'
        ? `What’s happened so far, and what you recommend. The trustees decide the next step — for example a CSOS application. ${b.breach.remedyBy ? `The last warning gave until ${formatDate(b.breach.remedyBy)}.` : ''}`
        : undefined,
    fields: [{ key: 'text', label: spec.label, type: 'textarea', required: true }],
    submitLabel: spec.submit,
    submit: (f) =>
      data.actBreach(b.breach.id, kind === 'note' ? { type: 'note', text: f['text'] } : { type: kind, note: f['text'] }, b.breach.version),
    success: () => spec.done,
    failure: 'It wasn’t saved',
  });
}
