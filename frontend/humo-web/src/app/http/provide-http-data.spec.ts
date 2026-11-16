import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AccessDataSource, AccountDataSource, BudgetDataSource, ComplianceDataSource, JobDataSource, describeFailure, MeetingDataSource, PayablesDataSource, PlatformTemplateDataSource, PolicyError, SchemeDataSource, SessionDataSource, SettingsDataSource, SignInError, StaffDataSource, StepUpAuthenticator, SupplierDataSource, TimelineDataSource, ReportDataSource, RulesDataSource, OpsDataSource } from '../domain';
import { NOT_CONNECTED, notConnected } from '../core/availability/not-connected';
import { provideHttpData } from './provide-http-data';

/**
 * The production data layer: what's on the API is called over HTTP; the rest
 * says "not connected" rather than falling back to anything simulated.
 */
describe('Production data layer (provideHttpData)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpData(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('signs out on the server, then reloads the session', async () => {
    const done = firstValueFrom(TestBed.inject(AccessDataSource).signOut('Humo Property Management'));
    http.expectOne({ method: 'POST', url: '/api/auth/sign-out' }).flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne({ method: 'GET', url: '/api/me' }).flush(null, { status: 401, statusText: 'Unauthorized' });
    await done;
  });

  it('switches role on the server', async () => {
    const done = firstValueFrom(TestBed.inject(AccessDataSource).switchRole('a-1'));
    const put = http.expectOne({ method: 'PUT', url: '/api/me/assignment' });
    expect(put.request.body).toEqual({ assignmentId: 'a-1' });
    put.flush({});
    http.expectOne('/api/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await done;
  });

  it('an expired sign-in link comes back as link-expired', async () => {
    const done = firstValueFrom(TestBed.inject(SessionDataSource).completeSignInLink('old', '123456'));
    http.expectOne('/api/auth/link/complete').flush({ code: 'link-expired', title: 'Expired' }, { status: 400, statusText: 'Bad Request' });
    await expect(done).rejects.toBeInstanceOf(SignInError);
    await expect(done).rejects.toMatchObject({ code: 'link-expired' });
  });

  it('a wrong code comes back as wrong-code, with the tries left in its message', async () => {
    const done = firstValueFrom(TestBed.inject(SessionDataSource).completeSignInLink('lnk', '000000'));
    http.expectOne('/api/auth/link/complete').flush({ code: 'wrong-code', title: 'That code isn’t right. 4 tries left' }, { status: 400, statusText: 'Bad Request' });
    await expect(done).rejects.toMatchObject({ code: 'wrong-code', message: 'That code isn’t right. 4 tries left' });
  });

  it('ports without an API yet say so', async () => {
    // Compliance is partly on the API: the financial year end is, the rest isn't yet.
    await expect(firstValueFrom(TestBed.inject(ComplianceDataSource).list(['s-1']))).rejects.toMatchObject({ kind: 'server' });
  });
  it('sends scheme rules and the registered rules PDF to the API (D29)', async () => {
    const rules = TestBed.inject(RulesDataSource);
    const added = firstValueFrom(rules.actRules('s-1', { type: 'add', number: '1', title: 'Pets', category: 'pets', text: 'A rule about pets, as adopted.', resolutionId: '' }));
    const add = http.expectOne({ method: 'POST', url: '/api/rules/s-1/actions' });
    expect(add.request.body.type).toBe('add');
    add.flush({ id: 'r-1' });
    await expect(added).resolves.toBe('r-1');

    const amended = firstValueFrom(rules.actRules('s-1', { type: 'amend', ruleId: 'r-1', text: 'New wording of the rule.', resolutionId: 'res-1' }));
    http.expectOne({ method: 'POST', url: '/api/rules/s-1/actions' }).flush(null, { status: 204, statusText: 'No Content' });
    await expect(amended).resolves.toBeUndefined();

    const upload = { type: 'upload', fileName: 'rules.pdf', mimeType: 'application/pdf', sizeBytes: 4, adoptedOn: '2026-01-01', resolutionRef: 'Registered with the CSOS', shareWithOwners: true } as const;
    await expect(firstValueFrom(rules.actRules('s-1', upload))).rejects.toMatchObject({ kind: 'validation' });
    const uploaded = firstValueFrom(rules.actRules('s-1', upload, new File(['%PDF'], 'rules.pdf', { type: 'application/pdf' })));
    const post = http.expectOne({ method: 'POST', url: '/api/rules/s-1/upload' });
    const form = post.request.body as FormData;
    expect(form.get('shareWithOwners')).toBe('true');
    expect(form.get('resolutionRef')).toBe('Registered with the CSOS');
    post.flush({ id: 'doc-1' });
    await expect(uploaded).resolves.toBe('doc-1');
  });

  it('sets up and publishes a customer’s custom template over HTTP (D12, D23)', async () => {
    const templates = TestBed.inject(PlatformTemplateDataSource);
    const created = firstValueFrom(templates.createCustomTemplate('org-1', 'levy-statement'));
    const post = http.expectOne({ method: 'POST', url: '/api/platform/customers/org-1/document-templates' });
    expect(post.request.body).toEqual({ documentType: 'levy-statement' });
    post.flush({ id: 'org-1.levy-statement' }, { status: 201, statusText: 'Created' });
    expect(await created).toBe('org-1.levy-statement');

    const design = { layout: 'levy-statement/branded' as const, brandingMode: 'template' as const, sections: ['summary' as const, 'transactions' as const] };
    const published = firstValueFrom(templates.publishCustomVersion('org-1.levy-statement', design, 'Colours', { approvedBy: 'Thandeka', approvedOn: '2026-10-18' }, 1));
    http.expectOne({ method: 'POST', url: '/api/platform/document-templates/org-1.levy-statement/versions' }).flush({ version: 2 });
    expect(await published).toBe(2);
  });

  it('owners pay online into the scheme’s own Payfast account; the agency links it (D25)', async () => {
    const accounts = TestBed.inject(AccountDataSource);
    const options = firstValueFrom(accounts.paymentOptions('acc-1'));
    http.expectOne({ method: 'GET', url: '/api/accounts/acc-1/payment-options' }).flush({ trustAccount: null, reference: 'KC-042', due: 1850, dueBy: '2026-11-07', card: true, sandbox: false });
    expect((await options).card).toBe(true);
    const checkout = firstValueFrom(accounts.startCardPayment('acc-1'));
    http.expectOne({ method: 'POST', url: '/api/accounts/acc-1/card-checkout' }).flush({ paymentId: 'p-1', providerReference: 'p-1', redirectUrl: null, simulated: false, form: { action: 'https://www.payfast.co.za/eng/process', fields: [] } });
    expect((await checkout).form?.action).toContain('payfast');

    const linked = firstValueFrom(TestBed.inject(SettingsDataSource).linkPayfast('s-1', { merchantId: '10004321', merchantKey: 'kc4merchantkey', passphrase: 'salt-salt' }));
    const put = http.expectOne({ method: 'PUT', url: '/api/settings/trust-accounts/s-1/payfast' });
    expect(put.request.body).toEqual({ merchantId: '10004321', merchantKey: 'kc4merchantkey', passphrase: 'salt-salt' });
    put.flush(null, { status: 204, statusText: 'No Content' });
    await linked;
  });

  it('offers an SMS code for approvals once the mobile is confirmed (D26)', async () => {
    const auth = TestBed.inject(StepUpAuthenticator);
    const methods = firstValueFrom(auth.methods('me'));
    http.expectOne('/api/me/mobile').flush({ mobile: 'the number ending 0101', verified: true, hasPasskey: true });
    expect((await methods).map((m) => m.method)).toEqual(['passkey', 'sms']);
    const sent = firstValueFrom(auth.sendSmsCode());
    http.expectOne({ method: 'POST', url: '/api/me/step-up/sms' }).flush({ sentTo: 'the number ending 0101' });
    expect(await sent).toBe('the number ending 0101');
    const verified = firstValueFrom(auth.verifySmsCode('123456'));
    http.expectOne({ method: 'POST', url: '/api/me/step-up/sms/verify' }).flush({ method: 'sms', device: 'SMS to the number ending 0101', at: '2026-10-28T10:00:00Z' });
    expect(await verified).toMatchObject({ verified: true, method: 'sms' });
  });

  it('reads timelines and logs notes over HTTP; unfinished screens are listed as not connected', async () => {
    const timeline = TestBed.inject(TimelineDataSource);
    const events = firstValueFrom(timeline.forUnit('u-1'));
    http.expectOne('/api/units/u-1/timeline').flush([{ id: 'n-1', at: '2026-10-28T10:00:00+02:00', kind: 'note', title: 'Note' }]);
    expect((await events)[0].kind).toBe('note');
    const added = firstValueFrom(timeline.addNote({ personId: 'p-1', kind: 'call', text: 'Called' }));
    http.expectOne({ method: 'POST', url: '/api/notes' }).flush({ id: 'n-2' }, { status: 201, statusText: 'Created' });
    await added;

    const routes = TestBed.inject(NOT_CONNECTED);
    expect(notConnected(routes, '/compliance')).toBe(true);
    expect(notConnected(routes, '/governance/rules')).toBe(false);
    expect(notConnected(routes, '/governance/meetings')).toBe(false);
    expect(notConnected(routes, '/reports')).toBe(false);
    expect(notConnected(routes, '/finance/budgets/b-1')).toBe(false);
    expect(notConnected(routes, '/finance/payables')).toBe(false);
    expect(notConnected(routes, '/finance/receipts')).toBe(false);
  });

  it('reads jobs and suppliers from the API', async () => {
    const jobs = firstValueFrom(TestBed.inject(JobDataSource).list(['s-1']));
    http.expectOne('/api/jobs?schemeIds=s-1').flush({ items: [], total: 0, page: 1, pageSize: 25 });
    expect((await jobs).total).toBe(0);
    const suppliers = firstValueFrom(TestBed.inject(SupplierDataSource).list(['s-1']));
    http.expectOne('/api/suppliers?schemeIds=s-1').flush([]);
    expect(await suppliers).toEqual([]);
  });

  it('runs meetings over HTTP: the upcoming view, and lifecycle commands with the version', async () => {
    const meetings = TestBed.inject(MeetingDataSource);
    const list = firstValueFrom(meetings.list(['s-1'], { filters: { view: 'upcoming' } }));
    http.expectOne({ method: 'GET', url: '/api/meetings?schemeIds=s-1&view=upcoming' }).flush({ items: [], total: 0, page: 1, pageSize: 25 });
    expect((await list).total).toBe(0);
    const sent = firstValueFrom(meetings.act('m-1', { type: 'send-notice' }, 4));
    const post = http.expectOne({ method: 'POST', url: '/api/meetings/m-1/actions' });
    expect(post.request.body).toEqual({ action: { type: 'send-notice' }, expectedVersion: 4 });
    post.flush(null, { status: 204, statusText: 'No Content' });
    await sent;
  });

  it('reads the feature switches from the API (receipt capture and import are on)', async () => {
    const flags = firstValueFrom(TestBed.inject(OpsDataSource).myFlags());
    http.expectOne({ method: 'GET', url: '/api/me/flags' }).flush({ 'receipt-capture': true });
    expect((await flags)['receipt-capture']).toBe(true);
  });

  it('runs a report over HTTP, with the schemes and months', async () => {
    const reports = TestBed.inject(ReportDataSource);
    const result = firstValueFrom(reports.run('receipts', { schemeIds: ['s-1', 's-2'], months: 6 }));
    http.expectOne({ method: 'GET', url: '/api/reports/receipts?schemeIds=s-1&schemeIds=s-2&months=6' }).flush({ def: { id: 'receipts' }, rows: [], columns: [], notes: [], scope: '2 schemes', generatedAt: '' });
    expect((await result)?.scope).toBe('2 schemes');
  });

  it('reads budgets, the year end, and records the owners’ approval over HTTP (D28)', async () => {
    const profiles = firstValueFrom(TestBed.inject(ComplianceDataSource).profiles(['s-1']));
    http.expectOne({ method: 'GET', url: '/api/settings/compliance-profiles?schemeIds=s-1' }).flush([{ schemeId: 's-1', financialYearEnd: 2, hasLifts: false }]);
    expect((await profiles)[0].financialYearEnd).toBe(2);
    const budgets = TestBed.inject(BudgetDataSource);
    const created = firstValueFrom(budgets.create({ schemeId: 's-1', year: 'current', increasePct: 0, financialYearEnd: 2 }));
    const post = http.expectOne({ method: 'POST', url: '/api/budgets' });
    expect(post.request.body).toEqual({ schemeId: 's-1', year: 'current', increasePct: 0, financialYearEnd: 2 });
    post.flush({ id: 'b-1' }, { status: 201, statusText: 'Created' });
    expect(await created).toBe('b-1');
    const recorded = firstValueFrom(budgets.act('b-1', { type: 'record-approval', approvedOn: '2026-03-20', resolutionRef: 'AGM 2026 resolution 4' }, 3));
    const act = http.expectOne({ method: 'POST', url: '/api/budgets/b-1/actions' });
    expect(act.request.body).toEqual({ action: { type: 'record-approval', approvedOn: '2026-03-20', resolutionRef: 'AGM 2026 resolution 4' }, expectedVersion: 3 });
    act.flush(null, { status: 204, statusText: 'No Content' });
    await recorded;
  });

  it('reads the team and sets away cover over HTTP', async () => {
    const staff = TestBed.inject(StaffDataSource);
    const team = firstValueFrom(staff.list());
    http.expectOne({ method: 'GET', url: '/api/staff' }).flush([{ id: 'u-1', name: 'Priya' }]);
    expect((await team)[0].name).toBe('Priya');
    const set = firstValueFrom(staff.setCover('u-1', { coverId: 'u-2', from: '2026-11-02', to: '2026-11-06', reason: 'Leave' }));
    const put = http.expectOne({ method: 'PUT', url: '/api/staff/u-1/cover' });
    expect(put.request.body).toEqual({ coverId: 'u-2', from: '2026-11-02', to: '2026-11-06', reason: 'Leave' });
    put.flush(null, { status: 204, statusText: 'No Content' });
    await set;
    const ended = firstValueFrom(staff.endCover('u-1'));
    http.expectOne({ method: 'DELETE', url: '/api/staff/u-1/cover' }).flush(null, { status: 204, statusText: 'No Content' });
    await ended;
  });

  it('pays suppliers over HTTP: bank details, batches, release with the payment file (D27)', async () => {
    const entered = firstValueFrom(TestBed.inject(SupplierDataSource).changeBankDetails('sup-1', { bankName: 'FNB', branchCode: '250655', accountNumber: '62012345678', accountType: 'cheque', accountHolder: 'GreenLeaf' }));
    http.expectOne({ method: 'POST', url: '/api/suppliers/sup-1/bank-details' }).flush(null, { status: 204, statusText: 'No Content' });
    await entered;
    const payables = TestBed.inject(PayablesDataSource);
    const batch = firstValueFrom(payables.createBatch(['inv-1', 'inv-2']));
    const post = http.expectOne({ method: 'POST', url: '/api/payables/batches' });
    expect(post.request.body).toEqual({ invoiceIds: ['inv-1', 'inv-2'] });
    post.flush({ id: 'b-1' }, { status: 201, statusText: 'Created' });
    expect(await batch).toBe('b-1');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:payments');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const released = firstValueFrom(payables.releaseBatch('b-1', 2));
    const release = http.expectOne({ method: 'POST', url: '/api/payables/batches/b-1/release' });
    expect(release.request.body).toEqual({ expectedVersion: 2 });
    release.flush(new Blob(['csv']), { headers: { 'content-disposition': 'attachment; filename="PB-KC-0001 payments.csv"' } });
    expect(await released).toBe('PB-KC-0001 payments.csv');
  });
  it('reads schemes from the API', async () => {
    const list = firstValueFrom(TestBed.inject(SchemeDataSource).list());
    http.expectOne({ method: 'GET', url: '/api/schemes' }).flush([{ id: 's-1', code: 'KC' }]);
    expect((await list)[0].code).toBe('KC');
  });

  it('creates a scheme and returns its id', async () => {
    const id = firstValueFrom(TestBed.inject(SchemeDataSource).create({ name: 'Kingfisher Court', code: 'KC', type: 'Sectional Title', suburb: 'Morningside', city: 'Sandton', province: 'Gauteng' }));
    http.expectOne({ method: 'POST', url: '/api/schemes' }).flush({ id: 's-9' }, { status: 201, statusText: 'Created' });
    expect(await id).toBe('s-9');
  });

  it('maps the API’s refusals onto the errors screens already handle', async () => {
    const schemes = TestBed.inject(SchemeDataSource);
    const outOfScope = firstValueFrom(schemes.setStatus('s-1', 'active', 'Handover complete'));
    http.expectOne('/api/schemes/s-1/status').flush({ title: 'Outside', code: 'out-of-scope' }, { status: 403, statusText: 'Forbidden' });
    await expect(outOfScope).rejects.toBeInstanceOf(PolicyError);
    await expect(outOfScope).rejects.toMatchObject({ code: 'out-of-scope' });

    // A sensitive action whose passkey confirmation is stale says what to do, not the policy's name.
    const noPasskey = firstValueFrom(schemes.setStatus('s-1', 'active', 'Handover complete'));
    http.expectOne('/api/schemes/s-1/status').flush({ title: 'Confirm it’s you with your passkey first', code: 'step-up-required' }, { status: 403, statusText: 'Forbidden' });
    const failure = await noPasskey.catch((e: unknown) => e);
    expect(describeFailure(failure, 'The invitation wasn’t sent')).toBe(
      'The invitation wasn’t sent: it needs your passkey, and your last confirmation was more than 5 minutes ago. Try again and confirm when your device asks.',
    );

    const invalid = firstValueFrom(schemes.update('s-1', { name: 'X', code: 'K1', type: 'Sectional Title', suburb: 'a', city: 'b', province: 'Gauteng' }, 1));
    http.expectOne('/api/schemes/s-1').flush({ title: 'Some details need attention', errors: { code: 'Use 2–4 letters' } }, { status: 422, statusText: 'Unprocessable' });
    await expect(invalid).rejects.toMatchObject({ kind: 'validation', fieldErrors: { code: 'Use 2–4 letters' } });

    const stale = firstValueFrom(schemes.update('s-1', { name: 'Kingfisher', code: 'KC', type: 'Sectional Title', suburb: 'a', city: 'b', province: 'Gauteng' }, 1));
    http.expectOne('/api/schemes/s-1').flush({ title: 'Someone else changed this first' }, { status: 409, statusText: 'Conflict' });
    await expect(stale).rejects.toMatchObject({ kind: 'conflict' });

    // A service the API needs is down (the virus scanner, say): its message reaches the person.
    const down = firstValueFrom(schemes.update('s-1', { name: 'Kingfisher', code: 'KC', type: 'Sectional Title', suburb: 'a', city: 'b', province: 'Gauteng' }, 1));
    http.expectOne('/api/schemes/s-1').flush({ title: 'The file can’t be checked for viruses right now, so it wasn’t stored. Try again shortly.' }, { status: 503, statusText: 'Service Unavailable' });
    await expect(down).rejects.toMatchObject({ kind: 'unavailable', message: 'The file can’t be checked for viruses right now, so it wasn’t stored. Try again shortly.' });
  });
  it('reads the access directory and invites over HTTP', async () => {
    const access = TestBed.inject(AccessDataSource);
    const dir = firstValueFrom(access.directory('org-1'));
    http.expectOne((r) => r.url === '/api/access/directory' && r.params.get('organisationId') === 'org-1').flush([{ id: 'p-1', email: 'lerato@acacia.example' }]);
    expect((await dir)[0].email).toBe('lerato@acacia.example');

    const invited = firstValueFrom(access.invite({ organisationId: 'org-1', name: 'Lerato Mokoena', email: 'lerato@acacia.example', assignment: { role: 'finance', scope: { type: 'organisation', organisationId: 'org-1', schemeIds: [] }, label: 'Acacia' } }));
    http.expectOne({ method: 'POST', url: '/api/access/invitations' }).flush({ id: 'p-2' }, { status: 201, statusText: 'Created' });
    expect(await invited).toBe('p-2');
  });
  it('"I’ve already paid" sends the proof of payment as a file, and plain text without one', async () => {
    const accounts = TestBed.inject(AccountDataSource);
    const proof = new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' });
    const withProof = firstValueFrom(accounts.reportPayment('acc-1', 'Paid R1 850 on 3 Nov', proof));
    const upload = http.expectOne({ method: 'POST', url: '/api/accounts/acc-1/payment-report' });
    expect(upload.request.body instanceof FormData).toBe(true);
    expect((upload.request.body as FormData).get('text')).toBe('Paid R1 850 on 3 Nov');
    expect(((upload.request.body as FormData).get('file') as File).name).toBe('proof.pdf');
    upload.flush(null, { status: 204, statusText: 'No Content' });
    await withProof;

    const textOnly = firstValueFrom(accounts.reportPayment('acc-1', 'Paid R1 850 on 3 Nov'));
    const json = http.expectOne({ method: 'POST', url: '/api/accounts/acc-1/payment-report' });
    expect(json.request.body).toEqual({ text: 'Paid R1 850 on 3 Nov' });
    json.flush(null, { status: 204, statusText: 'No Content' });
    await textOnly;
  });

  it('opens a timeline file through a signed link', async () => {
    const link = firstValueFrom(TestBed.inject(TimelineDataSource).fileLink('f-1'));
    http.expectOne('/api/files/f-1/link').flush({ url: '/api/files/f1/content?exp=1&sig=x', expiresAt: '2026-11-16T10:00:00Z' });
    expect(await link).toBe('/api/files/f1/content?exp=1&sig=x');
  });
});
