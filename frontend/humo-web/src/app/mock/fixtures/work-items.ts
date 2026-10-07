import { Role, WorkItem } from '../../domain';

/** A date relative to today, so "overdue" and "today" stay meaningful whenever the prototype is opened. */
function day(offset: number, hour = 9): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
}

const MAINTENANCE_APPROVERS: Role[] = ['agency-admin', 'portfolio-manager', 'trustee'];
const INVOICE_APPROVERS: Role[] = ['agency-admin', 'portfolio-manager', 'trustee'];
const PAYMENT_APPROVERS: Role[] = ['agency-admin', 'finance', 'trustee'];
const BILLING_APPROVERS: Role[] = ['agency-admin', 'finance'];

type Seed = Omit<WorkItem, 'status' | 'createdAt'> & { createdAt?: string };

const SEEDS: Seed[] = [
  // ---------------- Finance ----------------
  { id: 'w01', ref: 'BANK-KC', kind: 'task', type: 'receipt-allocation', title: '5 receipts to allocate', detail: 'FNB trust account import · R 14 920.00 unmatched', schemeId: 'kingfisher-court', count: 5, amount: 14920, dueAt: day(0, 17), assigneeId: 'staff-priya', route: '/finance/receipts' },
  { id: 'w02', ref: 'BANK-TW', kind: 'task', type: 'receipt-allocation', title: '4 receipts to allocate', detail: 'Nedbank trust account import · R 11 380.00 unmatched', schemeId: 'the-willows', count: 4, amount: 11380, dueAt: day(0, 17), assigneeId: 'staff-priya', route: '/finance/receipts' },
  { id: 'w03', ref: 'BANK-WRE', kind: 'task', type: 'receipt-allocation', title: '8 receipts to allocate', detail: 'ABSA trust account import · R 21 910.00 unmatched', schemeId: 'waterkloof-ridge', count: 8, amount: 21910, dueAt: day(0, 17), assigneeId: 'staff-priya', route: '/finance/receipts' },
  { id: 'w04', ref: 'KC-031', kind: 'task', type: 'debtor-follow-up', title: 'Unit 31 — 92 days in arrears', detail: 'Final demand sent 14 Sep. No response. Next step: letter of demand.', schemeId: 'kingfisher-court', unitLabel: 'Unit 31', personName: 'Lindiwe Ndlovu', amount: 14380.5, dueAt: day(-2), assigneeId: 'staff-zanele', route: '/finance/credit-control' },
  { id: 'w05', ref: 'JH-008', kind: 'task', type: 'debtor-follow-up', title: 'Unit 8 — payment arrangement missed', detail: 'Second instalment of R 1 500.00 not received on 1 Oct.', schemeId: 'jacaranda-heights', unitLabel: 'Unit 8', personName: 'Thabo Nkosi', amount: 6210, dueAt: day(0, 12), assigneeId: 'staff-zanele', route: '/finance/credit-control' },
  { id: 'w06', ref: 'MC-044', kind: 'task', type: 'debtor-follow-up', title: 'Unit 44 — letter of demand ready', detail: 'Approved by trustees on 30 Sep. Review and send.', schemeId: 'midrand-crossing', unitLabel: 'Unit 44', personName: 'Marius Pretorius', amount: 23900.75, dueAt: day(2), assigneeId: 'staff-zanele', route: '/finance/credit-control' },
  { id: 'w07', ref: 'BR-WRE-11', kind: 'approval', type: 'billing-run-approval', title: 'November billing — Waterkloof Ridge Estate', detail: '84 accounts · 2 exceptions resolved · special levy instalment 3 of 6 included', schemeId: 'waterkloof-ridge', amount: 286920, dueAt: day(3), assigneeId: null, approverRoles: BILLING_APPROVERS, evidence: ['Charges preview', 'Exceptions report (2 resolved)'], route: '/finance/billing' },
  { id: 'w08', ref: 'PB-0412', kind: 'approval', type: 'payment-batch-approval', title: 'Payment batch PB-0412 — 9 supplier payments', detail: 'All invoices approved and matched. Second authoriser required.', schemeId: 'kingfisher-court', amount: 58940.2, dueAt: day(0, 15), assigneeId: null, approverRoles: PAYMENT_APPROVERS, evidence: ['9 approved invoices', 'Bank balance R 412 600.00 after payment'], route: '/finance/payables' },
  { id: 'w09', ref: 'INV-20944', kind: 'approval', type: 'invoice-approval', title: 'Secure-Rite Security — October guarding', detail: 'Monthly contract invoice, matches contract SEC-2025-03.', schemeId: 'kingfisher-court', supplierName: 'Secure-Rite Security', amount: 21450, dueAt: day(1), assigneeId: null, approverRoles: INVOICE_APPROVERS, budget: { category: 'Security', annual: 252000, spent: 189300 }, evidence: ['Contract SEC-2025-03', 'Monthly service report'], route: '/finance/payables' },
  { id: 'w10', ref: 'INV-20951', kind: 'approval', type: 'invoice-approval', title: 'Rand Plumbing — geyser replacement, Unit 23', detail: 'Matches approved quote Q-3310 exactly. Completion verified by owner.', schemeId: 'the-willows', supplierName: 'Rand Plumbing & Drainage', amount: 14850, dueAt: day(0, 16), assigneeId: null, approverRoles: INVOICE_APPROVERS, budget: { category: 'Maintenance — plumbing', annual: 60000, spent: 31200 }, evidence: ['Quote Q-3310 (R 14 850.00)', 'Completion photos (4)', 'Owner confirmed fixed'], route: '/finance/payables' },
  { id: 'w11', ref: 'INV-20957', kind: 'approval', type: 'invoice-approval', title: 'GreenLeaf Garden Services — October', detail: 'Monthly garden service contract.', schemeId: 'ballito-dunes', supplierName: 'GreenLeaf Garden Services', amount: 9800, dueAt: day(4), assigneeId: null, approverRoles: INVOICE_APPROVERS, budget: { category: 'Gardens', annual: 120000, spent: 101000 }, evidence: ['Service contract GL-2024-11'], route: '/finance/payables' },
  { id: 'w12', ref: 'INV-20960', kind: 'approval', type: 'invoice-approval', title: 'Liftco — lift motor repair', detail: 'Invoice is R 3 400.00 above the approved quote. Re-approval needed.', schemeId: 'rosebank-terraces', supplierName: 'Liftco Elevators', amount: 31200, dueAt: day(-1), assigneeId: null, approverRoles: INVOICE_APPROVERS, budget: { category: 'Lift maintenance', annual: 90000, spent: 71400 }, evidence: ['Quote Q-3298 (R 27 800.00)', 'Variance: + R 3 400.00', 'Supplier note: extra bearing replaced'], route: '/finance/payables' },

  // ---------------- Maintenance ----------------
  { id: 'w13', ref: 'MR-1042', kind: 'approval', type: 'quote-approval', title: 'Roof waterproofing above Units 41–44', detail: '3 quotes compared. Recommended: Cape Seal Waterproofing (lowest compliant quote, 5-year guarantee).', schemeId: 'kingfisher-court', supplierName: 'Cape Seal Waterproofing', amount: 68500, dueAt: day(2), assigneeId: null, approverRoles: MAINTENANCE_APPROVERS, budget: { category: 'Maintenance — building', annual: 180000, spent: 122400 }, evidence: ['3 quotes compared', 'Photos (6)', 'Recommendation by J. van der Merwe'], route: '/maintenance/MR-1042' },
  { id: 'w14', ref: 'MR-1038', kind: 'approval', type: 'quote-approval', title: 'Replace main gate motor', detail: 'Motor burnt out after power surge. Gate on manual since 2 Oct.', schemeId: 'the-willows', supplierName: 'Gate Automation SA', amount: 18900, dueAt: day(0, 14), assigneeId: null, approverRoles: MAINTENANCE_APPROVERS, budget: { category: 'Maintenance — security', annual: 40000, spent: 12600 }, evidence: ['2 quotes compared', 'Insurance claim declined (wear & tear)'], route: '/maintenance/MR-1038' },
  { id: 'w15', ref: 'MR-1051', kind: 'approval', type: 'quote-approval', title: 'Repaint stairwell B', detail: 'Planned maintenance item from the 10-year plan.', schemeId: 'kingfisher-court', supplierName: 'PaintPro Gauteng', amount: 24300, dueAt: day(6), assigneeId: null, approverRoles: MAINTENANCE_APPROVERS, budget: { category: 'Maintenance — building', annual: 180000, spent: 122400 }, evidence: ['3 quotes compared'], route: '/maintenance/MR-1051' },
  { id: 'w16', ref: 'MR-1029', kind: 'approval', type: 'quote-approval', title: 'Clubhouse roof repair', detail: 'Leak above the clubhouse kitchen. Temporary tarp in place.', schemeId: 'lonehill-village', supplierName: 'Top Roof Contractors', amount: 42750, dueAt: day(-3), assigneeId: null, approverRoles: MAINTENANCE_APPROVERS, budget: { category: 'Maintenance — building', annual: 150000, spent: 138900 }, evidence: ['2 quotes compared', 'Budget will be exceeded by R 31 650.00'], route: '/maintenance/MR-1029' },
  { id: 'w17', ref: 'MR-1012', kind: 'task', type: 'maintenance-overdue', title: 'Leaking geyser, Unit 23 — not resolved', detail: 'Contractor scheduled for 1 Oct; no completion report received.', schemeId: 'kingfisher-court', unitLabel: 'Unit 23', supplierName: 'Rand Plumbing & Drainage', dueAt: day(-5), assigneeId: 'staff-johan', route: '/maintenance/MR-1012' },
  { id: 'w18', ref: 'MR-1019', kind: 'task', type: 'maintenance-overdue', title: 'Pool pump failure', detail: 'Pool green since 28 Sep. Awaiting part from supplier.', schemeId: 'northcliff-view', supplierName: 'AquaCare Pools', dueAt: day(-2), assigneeId: 'staff-johan', route: '/maintenance/MR-1019' },
  { id: 'w19', ref: 'MR-1060', kind: 'task', type: 'maintenance-triage', title: 'New: water damage in Unit 3 ceiling', detail: 'Reported by owner with 3 photos. Possibly from Unit 7 above.', schemeId: 'morningside-manor', unitLabel: 'Unit 3', personName: 'Grace Mahlangu', dueAt: day(0, 13), assigneeId: null, route: '/maintenance/MR-1060' },
  { id: 'w20', ref: 'MR-1061', kind: 'task', type: 'maintenance-triage', title: 'New: intercom not working — Block A', detail: 'Reported by 3 residents this morning.', schemeId: 'kingfisher-court', dueAt: day(1), assigneeId: null, route: '/maintenance/MR-1061' },
  { id: 'w21', ref: 'MR-0998', kind: 'task', type: 'maintenance-overdue', title: 'Boundary wall crack — engineer report outstanding', detail: 'Structural engineer site visit was 22 Sep.', schemeId: 'benoni-lakeside', dueAt: day(-8), assigneeId: 'staff-kabelo', route: '/maintenance/MR-0998' },
  { id: 'w22', ref: 'MR-1007', kind: 'task', type: 'maintenance-overdue', title: 'Streetlight repair, internal road', detail: 'Electrician did not arrive on 4 Oct.', schemeId: 'centurion-palms', dueAt: day(-1), assigneeId: 'staff-naledi', route: '/maintenance/MR-1007' },

  // ---------------- Compliance ----------------
  { id: 'w23', ref: 'CMP-JH-INS', kind: 'task', type: 'compliance-due', title: 'Building insurance renewal', detail: 'Renewal due in 5 days. Broker quote received; trustees to confirm.', schemeId: 'jacaranda-heights', dueAt: day(5), assigneeId: 'staff-naledi', route: '/compliance' },
  { id: 'w24', ref: 'CMP-KC-AGM', kind: 'task', type: 'compliance-due', title: 'Set AGM date and send notice', detail: 'AGM must be held within 4 months of financial year-end (30 Nov).', schemeId: 'kingfisher-court', dueAt: day(6), assigneeId: 'staff-johan', route: '/governance/meetings' },
  { id: 'w25', ref: 'CMP-SLM-CSOS', kind: 'task', type: 'compliance-due', title: 'CSOS annual return overdue', detail: 'Return and levy for the 2025/26 year not yet submitted.', schemeId: 'silverlakes-manor', dueAt: day(-4), assigneeId: 'staff-thandeka', route: '/compliance' },
  { id: 'w26', ref: 'DOC-SUP-112', kind: 'task', type: 'document-expiry', title: 'Rand Plumbing — COIDA letter expires', detail: 'Letter of good standing expires in 9 days. Request a new one.', schemeId: 'the-willows', supplierName: 'Rand Plumbing & Drainage', dueAt: day(9), assigneeId: 'staff-johan', route: '/suppliers' },
  { id: 'w27', ref: 'CMP-BDE-FIRE', kind: 'task', type: 'compliance-due', title: 'Fire equipment service certificate expired', detail: 'Annual service lapsed 24 Sep. Book service provider.', schemeId: 'ballito-dunes', dueAt: day(-12), assigneeId: 'staff-kabelo', route: '/compliance' },

  // ---------------- Governance ----------------
  { id: 'w28', ref: 'RES-KC-14', kind: 'task', type: 'meeting-action', title: 'Obtain 3 quotes for CCTV upgrade', detail: 'Resolution 14 · Trustee meeting 18 Sep', schemeId: 'kingfisher-court', dueAt: day(3), assigneeId: 'staff-johan', route: '/governance/resolutions' },
  { id: 'w29', ref: 'RES-KC-15', kind: 'task', type: 'meeting-action', title: 'Circulate revised pet rule to owners', detail: 'Resolution 15 · Trustee meeting 18 Sep', schemeId: 'kingfisher-court', dueAt: day(-1), assigneeId: 'p-sipho', route: '/governance/resolutions' },
  { id: 'w30', ref: 'RES-TW-07', kind: 'task', type: 'meeting-action', title: 'Instruct attorney on Unit 9 arrears', detail: 'Resolution 7 · Trustee meeting 25 Sep', schemeId: 'the-willows', dueAt: day(10), assigneeId: 'staff-johan', route: '/governance/resolutions' },

  // ---------------- Messages (Inbox) ----------------
  { id: 'w31', ref: 'MSG-5521', kind: 'message', type: 'owner-message', title: 'When will the lift be repaired?', detail: 'Owner of Unit 8 has elderly parents visiting next week.', schemeId: 'rosebank-terraces', unitLabel: 'Unit 8', personName: 'Pieter Joubert', dueAt: day(0, 12), assigneeId: 'staff-johan', route: '/inbox' },
  { id: 'w32', ref: 'MSG-5524', kind: 'message', type: 'owner-message', title: 'Request for levy clearance figures', detail: 'Unit is being sold; conveyancer needs figures by Friday.', schemeId: 'kingfisher-court', unitLabel: 'Unit 42', personName: 'Anele Mthembu', dueAt: day(1), assigneeId: 'staff-johan', route: '/inbox' },
  { id: 'w33', ref: 'MSG-5530', kind: 'message', type: 'owner-message', title: 'Dispute: interest charged in September', detail: 'Owner says the payment was made before the due date.', schemeId: 'jacaranda-heights', unitLabel: 'Unit 15', personName: 'Ayesha Patel', dueAt: day(0, 15), assigneeId: 'staff-zanele', route: '/inbox' },
  { id: 'w34', ref: 'MSG-5533', kind: 'message', type: 'owner-message', title: 'Agenda items for the October meeting', detail: 'Chairperson proposes adding the CCTV upgrade and pet rule.', schemeId: 'kingfisher-court', personName: 'Sipho Khumalo', dueAt: day(2), assigneeId: 'staff-johan', route: '/inbox' },
  { id: 'w35', ref: 'MSG-5536', kind: 'message', type: 'owner-message', title: 'Noise complaint — Unit 12', detail: 'Tenant of Unit 14 reports late-night noise on weekends.', schemeId: 'midrand-crossing', unitLabel: 'Unit 14', personName: 'Kagiso Mokoena', dueAt: day(1), assigneeId: 'staff-johan', route: '/inbox' },
  { id: 'w36', ref: 'MSG-5540', kind: 'message', type: 'owner-message', title: 'Levy statement not received', detail: 'Owner did not receive the October statement by email.', schemeId: 'waterkloof-ridge', unitLabel: 'Unit 61', personName: 'Hendrik Steyn', dueAt: day(0, 11), assigneeId: 'staff-naledi', route: '/inbox' },
];

export function createWorkItems(): WorkItem[] {
  return SEEDS.map((s) => ({
    ...s,
    status: 'open',
    createdAt: s.createdAt ?? new Date(new Date(s.dueAt).getTime() - 5 * 86_400_000).toISOString(),
  }));
}
