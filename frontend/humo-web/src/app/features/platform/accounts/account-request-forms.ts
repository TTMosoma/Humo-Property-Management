import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, map, of, take } from 'rxjs';
import { ACCOUNT_POLICY_LABELS, AccessDataSource, AccountApprovalPolicy, AccountPolicySetting, AccountRequestDataSource, AccountRequestView, CommercialDataSource, Identity, NewAccountDetails, PackageId, activeAssignments } from '../../../domain';
import { CatalogueService } from '../../../core/catalogue/catalogue.service';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { PROVINCE_OPTIONS, REASON_FIELD, openForm } from '../../shared/form-drawer';

/**
 * Opens "New customer account" from anywhere on the platform. The form only
 * *describes* what will happen (approval or delegated activation): the API
 * decides, from the person's own grants and the policy, and the confirmation
 * reports what it actually did.
 */
@Injectable({ providedIn: 'root' })
export class NewAccountLauncher {
  private readonly drawer = inject(DrawerService);
  private readonly requests = inject(AccountRequestDataSource);
  private readonly router = inject(Router);
  private readonly catalogue = inject(CatalogueService);
  private readonly session = inject(SessionService);
  private readonly managers = toSignal(
    inject(AccessDataSource)
      .humoTeam()
      .pipe(
        map((team) => team.filter((i) => i.status === 'active' && activeAssignments(i).some((a) => a.role === 'humo-account-manager'))),
        catchError(() => of([] as Identity[])),
      ),
    { initialValue: [] as Identity[] },
  );
  /** New customers go to the designated account manager by default (Pricing & add-ons › Commercial settings). */
  private readonly designated = toSignal(inject(CommercialDataSource).catalogue().pipe(map((c) => c.settings.designatedAccountManagerId), catchError(() => of(''))), { initialValue: '' });

  open(): void {
    this.requests
      .policy()
      .pipe(take(1))
      .subscribe((p) => {
        const delegated = this.session.can('Platform.Customers.ActivateWithoutApproval') && p.policy === 'delegation-allowed';
        const me = this.session.actor().id;
        const managers = this.managers();
        openForm(this.drawer, {
          eyebrow: 'Customers',
          title: 'New customer account',
          intro: delegated
            ? 'You have delegated authority: the account is activated as soon as you submit it, and starts onboarding on a 30-day trial. System Administrators are notified, and it’s recorded in the audit log.'
            : 'It goes to a System Administrator for approval. Once approved, it starts onboarding on a 30-day trial. You’ll be notified of the decision.',
          fields: [
            { key: 'name', label: 'Registered name', type: 'text', required: true, placeholder: 'Mabena Property Group (Pty) Ltd' },
            { key: 'shortName', label: 'Name people use', type: 'text', required: true, placeholder: 'Mabena Property', help: 'Shown in the app, on statements and in the support view.' },
            { key: 'city', label: 'City', type: 'text', required: true, half: true },
            { key: 'province', label: 'Province', type: 'select', required: true, half: true, options: PROVINCE_OPTIONS },
            { key: 'packageId', label: 'Package for the trial', type: 'select', required: true, half: true, options: this.catalogue.packages().map((x) => ({ value: x.id, label: x.name })) },
            { key: 'accountManagerId', label: 'Account manager', type: 'select', required: true, half: true, options: managers.map((m) => ({ value: m.id, label: m.name })) },
            { key: 'notes', label: 'Notes for the approver', type: 'textarea', placeholder: 'e.g. Referred by Tshikrand. 14 schemes, moving from spreadsheets.' },
          ],
          initial: { province: 'Gauteng', packageId: 'professional', accountManagerId: managers.some((m) => m.id === me) ? me : managers.some((m) => m.id === this.designated()) ? this.designated() : (managers[0]?.id ?? '') },
          submitLabel: delegated ? 'Activate account' : 'Submit for approval',
          submit: (v) => {
            const details: NewAccountDetails = {
              name: v['name'], shortName: v['shortName'], city: v['city'], province: v['province'],
              packageId: v['packageId'] as PackageId, accountManagerId: v['accountManagerId'], notes: v['notes'],
            };
            return this.requests.submit(details);
          },
          success: (r, v) =>
            r.outcome === 'activated'
              ? `${v['shortName']} is activated (${r.ref}) under your delegated authority. It’s onboarding: invite their first administrator next.`
              : `${v['shortName']} (${r.ref}) is waiting for a System Administrator’s approval.`,
          done: (r) => this.router.navigate(['/platform/account-requests', r.requestId]),
          failure: 'The account wasn’t submitted',
        });
      });
  }
}

/** Approve, or reject with a reason the submitter will see. */
export function decisionForm(drawer: DrawerService, data: AccountRequestDataSource, v: AccountRequestView, decision: 'approve' | 'reject'): void {
  const r = v.request;
  openForm(drawer, {
    eyebrow: `${r.ref} · ${r.details.shortName}`,
    title: decision === 'approve' ? 'Approve this account' : 'Reject this account',
    intro:
      decision === 'approve'
        ? `${r.details.shortName} becomes a customer in onboarding, on a 30-day trial of the package, looked after by ${r.accountManager}. Nobody can sign in until their first administrator is invited and accepts.`
        : `${r.requestedBy} sees your reason. No organisation is created.`,
    fields: decision === 'reject' ? [REASON_FIELD] : [],
    submitLabel: decision === 'approve' ? 'Approve' : 'Reject',
    submit: (f) => data.decide(r.id, decision === 'approve' ? { type: 'approve' } : { type: 'reject', reason: f['reason'] }, r.version),
    success: () => (decision === 'approve' ? `${r.details.shortName} is approved and onboarding.` : `${r.ref} was rejected.`),
    failure: decision === 'approve' ? 'It wasn’t approved' : 'It wasn’t rejected',
  });
}

/** System Administrators: which new accounts need approval. Applies to new requests only. */
export function policyForm(drawer: DrawerService, data: AccountRequestDataSource, current: AccountPolicySetting): void {
  const next: AccountApprovalPolicy = current.policy === 'delegation-allowed' ? 'approval-for-all' : 'delegation-allowed';
  openForm(drawer, {
    eyebrow: 'Account-creation policy',
    title: next === 'approval-for-all' ? 'Require approval for every account' : 'Allow delegated activation',
    intro:
      next === 'approval-for-all'
        ? 'Every new account will wait for a System Administrator, including from Account Managers with delegated activation. Their grants stay; they work again if you switch back. Requests already waiting aren’t changed.'
        : 'Account Managers who have been granted delegated activation can activate new accounts themselves again. Nobody else changes: approval stays the default. Requests already waiting aren’t changed.',
    fields: [REASON_FIELD],
    stepUp: { action: 'change-platform-config', detail: `Account-creation policy: ${ACCOUNT_POLICY_LABELS[next]}` },
    submitLabel: 'Change the policy',
    submit: (f) => data.setPolicy(next, f['reason'], current.version),
    success: () => `The policy is now: ${ACCOUNT_POLICY_LABELS[next]}.`,
    failure: 'The policy wasn’t changed',
  });
}
