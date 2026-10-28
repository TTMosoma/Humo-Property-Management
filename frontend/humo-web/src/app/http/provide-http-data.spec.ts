import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AccessDataSource, AccountDataSource, ApiError, JobDataSource, describeFailure, MeetingDataSource, PayablesDataSource, PlatformTemplateDataSource, PolicyError, SchemeDataSource, SessionDataSource, SettingsDataSource, SignInError, StepUpAuthenticator, SupplierDataSource } from '../domain';
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
    await expect(firstValueFrom(TestBed.inject(MeetingDataSource).list(['s-1']))).rejects.toBeInstanceOf(ApiError);
    await expect(firstValueFrom(TestBed.inject(PayablesDataSource).batches(['s-1']))).rejects.toMatchObject({ kind: 'server' });
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

  it('reads jobs and suppliers from the API', async () => {
    const jobs = firstValueFrom(TestBed.inject(JobDataSource).list(['s-1']));
    http.expectOne('/api/jobs?schemeIds=s-1').flush({ items: [], total: 0, page: 1, pageSize: 25 });
    expect((await jobs).total).toBe(0);
    const suppliers = firstValueFrom(TestBed.inject(SupplierDataSource).list(['s-1']));
    http.expectOne('/api/suppliers?schemeIds=s-1').flush([]);
    expect(await suppliers).toEqual([]);
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
});
