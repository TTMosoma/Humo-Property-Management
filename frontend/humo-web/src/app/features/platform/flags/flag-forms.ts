import { ENVIRONMENTS, Environment, FeatureFlag, OpsDataSource, PlatformCustomer } from '../../../domain';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { REASON_FIELD, openForm } from '../../shared/form-drawer';

const envLabel = (e: Environment) => ENVIRONMENTS.find((x) => x.id === e)!.label;

/** Change one environment's rule: on/off, rollout %, allowed and excluded customers. Production needs step-up. */
export function flagRuleForm(drawer: DrawerService, data: OpsDataSource, flag: FeatureFlag, environment: Environment, customers: PlatformCustomer[]): void {
  const r = flag.rules[environment];
  const options = customers.map((c) => ({ value: c.organisationId, label: c.name })).sort((a, b) => a.label.localeCompare(b.label));
  openForm(drawer, {
    eyebrow: `${flag.key} · ${envLabel(environment)}`,
    title: `${flag.name}: ${envLabel(environment)}`,
    intro:
      environment === 'production'
        ? 'This reaches customers as soon as you save, so it needs your passkey or Humo Mobile. Plan entitlements still apply: a flag only switches on what a customer has paid for.'
        : `Applies to ${envLabel(environment).toLowerCase()} only.`,
    fields: [
      { key: 'enabled', label: 'Switched', type: 'select', required: true, half: true, options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
      { key: 'rollout', label: 'Rollout (% of customers)', type: 'number', required: true, half: true, help: 'The same customers stay in as it grows.', showIf: (v) => v['enabled'] === 'on' },
      { key: 'allow', label: 'Always on for', type: 'checks', options, showIf: (v) => v['enabled'] === 'on' && environment === 'production', help: 'E.g. pilot customers.' },
      { key: 'deny', label: 'Never on for', type: 'checks', options, showIf: (v) => v['enabled'] === 'on' && environment === 'production' },
      REASON_FIELD,
    ],
    initial: { enabled: r.enabled ? 'on' : 'off', rollout: String(r.rollout), allow: r.allow.join(','), deny: r.deny.join(',') },
    submitLabel: 'Save',
    stepUp: environment === 'production' ? { action: 'change-platform-config', detail: `Change feature flag ${flag.key} in production` } : undefined,
    submit: (v) =>
      data.updateFlag(
        flag.key,
        environment,
        {
          enabled: v['enabled'] === 'on',
          rollout: v['enabled'] === 'on' ? Number(v['rollout']) : r.rollout,
          allow: v['enabled'] === 'on' ? (v['allow'] ?? '').split(',').filter(Boolean) : r.allow,
          deny: v['enabled'] === 'on' ? (v['deny'] ?? '').split(',').filter(Boolean) : r.deny,
        },
        v['reason'],
        flag.version,
      ),
    success: () => `${flag.name} updated in ${envLabel(environment).toLowerCase()}.`,
    failure: 'The flag wasn’t changed',
  });
}

/** A kill switch, off or back on in production, everywhere at once. */
export function killSwitchForm(drawer: DrawerService, data: OpsDataSource, flag: FeatureFlag): void {
  const r = flag.rules.production;
  const turningOff = r.enabled;
  openForm(drawer, {
    eyebrow: flag.key,
    title: turningOff ? `Switch off: ${flag.name}` : `Switch back on: ${flag.name}`,
    intro: turningOff ? `${flag.description} This takes effect for every customer immediately.` : 'Everyone gets it back immediately.',
    fields: [REASON_FIELD],
    submitLabel: turningOff ? 'Switch off now' : 'Switch back on',
    stepUp: { action: 'change-platform-config', detail: `${turningOff ? 'Switch off' : 'Switch on'} ${flag.key} for every customer` },
    submit: (v) => data.updateFlag(flag.key, 'production', { ...r, enabled: !turningOff }, v['reason'], flag.version),
    success: () => (turningOff ? `${flag.name} is off everywhere.` : `${flag.name} is back on.`),
    failure: 'The switch wasn’t changed',
  });
}
