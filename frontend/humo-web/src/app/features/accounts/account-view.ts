import { ACCOUNT_STATUS_LABEL, Account, AccountStatus, Occupancy, Person, Scheme, Unit, UnitSummary, describeFailure, fieldErrorsOf } from '../../domain';
import { ChainLink } from '../../ui/record/relationship-chain';
import { Tone } from '../../ui/status-pill/status-pill';

export const ACCOUNT_TONE: Record<AccountStatus, Tone> = {
  'up-to-date': 'success',
  'in-credit': 'accent',
  arrears: 'danger',
  arrangement: 'warning',
  'handed-over': 'danger',
};

export const OCCUPANCY_LABEL: Record<Occupancy, string> = {
  'owner-occupied': 'Owner-occupied',
  tenanted: 'Tenanted',
  vacant: 'Vacant',
};

export function accountStatus(a: Account): { label: string; tone: Tone } {
  // Owing only this month's charges isn't arrears — but "up to date" next to a balance confuses people.
  if (a.status === 'up-to-date' && a.balance > 0) return { label: 'Current month due', tone: 'info' };
  return { label: ACCOUNT_STATUS_LABEL[a.status], tone: ACCOUNT_TONE[a.status] };
}

/** Balance wording people understand: "R 4 812.50 due", "R 1 740.00 in credit", "Paid up". */
export function balanceTone(a: Account): 'danger' | 'warning' | 'success' | 'default' {
  if (a.balance < 0) return 'success';
  if (a.status === 'arrears' || a.status === 'handed-over') return 'danger';
  if (a.balance > 0) return 'warning';
  return 'default';
}

// ---- Canonical links (one place, so the Scheme → Unit → Owner → Account chain is always the same) ----

export const links = {
  scheme: (s: Pick<Scheme, 'id'>) => `/schemes/${s.id}/overview`,
  unit: (s: Pick<Scheme, 'id'>, u: Pick<Unit, 'number'>) => `/schemes/${s.id}/units/${u.number}`,
  account: (s: Pick<Scheme, 'id'>, u: Pick<Unit, 'number'>) => `/schemes/${s.id}/units/${u.number}/account`,
  statement: (s: Pick<Scheme, 'id'>, u: Pick<Unit, 'number'>, period: string) => `/schemes/${s.id}/units/${u.number}/account/statements/${period}`,
  person: (p: Pick<Person, 'id'>) => `/people/${p.id}`,
};

/** The relationship chain shown on every unit, account and statement page. */
export function unitChain(summary: Pick<UnitSummary, 'scheme' | 'unit' | 'owners'>, account?: Account): ChainLink[] {
  const { scheme, unit, owners } = summary;
  const chain: ChainLink[] = [
    { kind: 'Scheme', label: scheme.name, route: links.scheme(scheme) },
    { kind: 'Unit', label: `Unit ${unit.number}`, route: links.unit(scheme, unit) },
  ];
  const owner = owners[0];
  if (owner) chain.push({ kind: owners.length > 1 ? 'Owners' : 'Owner', label: owner.displayName + (owners.length > 1 ? ` +${owners.length - 1}` : ''), route: links.person(owner) });
  if (account) chain.push({ kind: 'Account', label: account.accountNo, route: links.account(scheme, unit) });
  return chain;
}

/** A toast for a statement that couldn't be emailed: the reason, when the API gave one (e.g. no email address). */
export function statementSendFailure(e: unknown): string {
  const reason = Object.values(fieldErrorsOf(e))[0];
  return reason ? `The statement wasn’t sent. ${reason}` : describeFailure(e, 'The statement wasn’t sent');
}
