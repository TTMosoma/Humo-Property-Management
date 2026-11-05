import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Permission, Role, WorkItem, WorkItemDataSource, WorkItemType } from '../../domain';
import { ScopeService } from '../scope/scope.service';
import { SessionService } from '../session/session.service';
import { AttentionService } from './attention.service';

const item = (type: WorkItemType, extra: Partial<WorkItem> = {}): WorkItem =>
  ({ id: type, type, kind: 'task', status: 'open', schemeId: 'kc', assigneeId: null, dueAt: '2026-11-30', ...extra }) as WorkItem;

const ITEMS = [
  item('receipt-allocation'),
  item('maintenance-triage'),
  item('follow-up'),
  item('rule-breach', { assigneeId: 'me' }),
  item('bank-details-verification', { kind: 'approval', approverRoles: ['agency-admin', 'finance'] }),
];

describe('AttentionService (D32: the same rule as the API)', () => {
  function visibleTo(role: Role, permissions: Permission[] = []): string[] {
    const assignment = computed(() => ({ id: 'a', role, scope: { type: 'organisation', organisationId: 'org', schemeIds: [] } }));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionService,
          useValue: { dataOwner: signal('me|a'), assignment, role: () => role, selfIds: () => ['me'], can: (p: Permission) => permissions.includes(p), identity: () => ({ id: 'me' }) },
        },
        { provide: ScopeService, useValue: { accessible: () => [{ id: 'kc' }], effectiveIds: () => ['kc'] } },
        { provide: WorkItemDataSource, useValue: { watch: () => of(ITEMS) } },
      ],
    });
    const attention = TestBed.inject(AttentionService);
    TestBed.tick();
    return attention.visible().map((w) => w.type);
  }

  it('shows Finance its own work and approvals, and no rule breach even when assigned to them', () => {
    expect(visibleTo('finance')).toEqual(['receipt-allocation', 'bank-details-verification']);
  });

  it('shows a portfolio manager breaches, but not bank details', () => {
    expect(visibleTo('portfolio-manager', ['Rules.Enforce'])).toEqual(['maintenance-triage', 'follow-up', 'rule-breach']);
  });
});
