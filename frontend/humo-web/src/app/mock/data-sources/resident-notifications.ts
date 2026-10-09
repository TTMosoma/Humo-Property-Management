import { Injectable, inject } from '@angular/core';
import { AppNotification, NotificationEvent, RoleAssignment, periodLabel } from '../../domain';
import { formatRand } from '../../ui/format/money';
import { BillingStore } from '../db/billing-store';
import { CollectionsStore } from '../db/collections-store';
import { LibraryStore } from '../db/library-store';
import { MaintenanceStore } from '../db/maintenance-store';
import { MockDb } from '../db/mock-db';
import { NoticeStore } from '../db/notice-store';
import { OpsStore } from '../db/ops-store';
import { SettingsStore } from '../db/settings-store';

const WINDOW_DAYS = 45;
const LETTER = { reminder: 'Payment reminder', 'final-demand': 'Final demand', 'letter-of-demand': 'Letter of demand' } as const;

/**
 * What owners and tenants are told (review finding F24: the portal needs a
 * reason to be opened). Worked out from the same records the agency uses —
 * payments allocated, statements sent, requests moving on, notices,
 * documents shared, collection letters — and only for events the agency's
 * notification rules switch on.
 */
@Injectable({ providedIn: 'root' })
export class ResidentNotifications {
  private readonly db = inject(MockDb);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly billing = inject(BillingStore);
  private readonly collections = inject(CollectionsStore);
  private readonly library = inject(LibraryStore);
  private readonly notices = inject(NoticeStore);
  private readonly settings = inject(SettingsStore);
  private readonly ops = inject(OpsStore);

  for(a: RoleAssignment, personId: string | undefined): AppNotification[] {
    if (a.role !== 'owner' && a.role !== 'tenant') return [];
    const schemeId = a.scope.schemeIds[0];
    const unitId = a.scope.unitId;
    const scheme = schemeId ? this.db.schemes.get(schemeId) : undefined;
    if (!scheme || !unitId) return [];
    if (!this.ops.isOn('notifications.resident-live', scheme.organisationId)) return [];
    const on = (e: NotificationEvent) => this.settings.rule(scheme.organisationId, e).enabled;
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const account = this.db.accountForUnit(unitId);
    const unit = this.db.unitById.get(unitId);
    const base: Pick<AppNotification, 'schemeId' | 'audience' | 'unitLabel' | 'read'> = { schemeId, audience: [a.role], unitLabel: unit ? `Unit ${unit.number}` : undefined, read: false };
    const out: AppNotification[] = [];

    if (a.role === 'owner' && account) {
      if (on('payment-received')) {
        for (const r of this.db.receipts.filter((x) => x.status === 'allocated' && x.date >= since && x.allocations.some((al) => al.accountId === account.id))) {
          const amount = r.allocations.filter((al) => al.accountId === account.id).reduce((n, al) => n + al.amount, 0);
          out.push({ ...base, id: `rn-pay-${r.id}`, kind: 'finance', title: `Payment received: ${formatRand(amount)}`, detail: `Thank you. It’s on your levy account ${account.accountNo}.`, at: r.date, link: '/my/account' });
        }
      }
      if (on('statement-issued')) {
        for (const run of this.billing.runs.filter((x) => x.schemeId === schemeId && x.statements && x.statements.at >= since)) {
          out.push({ ...base, id: `rn-st-${run.id}`, kind: 'finance', title: `Your ${periodLabel(run.period)} statement`, detail: 'Your levy statement is ready to view.', at: run.statements!.at, link: `/my/statements/${run.period}` });
        }
      }
      if (on('collection-letter')) {
        for (const s of this.collections.caseFor(account.id).steps.filter((x) => x.letter && x.at >= since)) {
          out.push({ ...base, id: `rn-cl-${s.id}`, kind: 'finance', title: `${LETTER[s.letter!.kind]} about your levy account`, detail: `${formatRand(s.letter!.amount)} overdue. Pay by ${new Date(s.letter!.dueBy).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}, or contact us to arrange.`, at: s.at, link: '/my/account' });
        }
      }
    }
    if (on('job-updated') && personId) {
      for (const j of this.maintenance.jobs.filter((x) => x.reportedBy.personId === personId)) {
        for (const e of j.events.filter((x) => x.kind === 'stage' && x.at >= since)) {
          out.push({ ...base, id: `rn-job-${e.id}`, kind: 'maintenance', title: j.title, detail: e.text, at: e.at, link: '/my/requests' });
        }
      }
    }
    if (on('notice-published')) {
      for (const v of this.notices.forResident(schemeId, a.role).filter((x) => x.notice.publishedAt >= since)) {
        out.push({ ...base, id: `rn-ntc-${v.notice.id}`, kind: 'communication', title: v.notice.title, detail: v.notice.body.length > 110 ? `${v.notice.body.slice(0, 107)}…` : v.notice.body, at: v.notice.publishedAt, link: '/my/notices' });
      }
    }
    if (on('document-published')) {
      for (const d of this.library.documents.filter((x) => !x.archived && x.uploadedAt >= since)) {
        const forOwners = a.role === 'owner' && d.visibility === 'owners' && d.schemeIds.includes(schemeId);
        const forUnit = d.visibility === 'unit' && d.links.some((l) => l.kind === 'unit' && l.id === unitId);
        if (forOwners || forUnit) out.push({ ...base, id: `rn-doc-${d.id}`, kind: 'communication', title: `New document: ${d.title}`, detail: forUnit ? 'Shared with your unit.' : 'Shared with the owners.', at: d.uploadedAt, link: '/my/documents' });
      }
    }
    return out;
  }
}
