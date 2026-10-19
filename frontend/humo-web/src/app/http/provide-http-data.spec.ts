import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AccessDataSource, ApiError, PolicyError, SchemeDataSource, SessionDataSource, SignInError, UnitDataSource } from '../domain';
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
    const done = firstValueFrom(TestBed.inject(SessionDataSource).completeSignInLink('old'));
    http.expectOne('/api/auth/link/complete').flush({ code: 'link-expired', title: 'Expired' }, { status: 400, statusText: 'Bad Request' });
    await expect(done).rejects.toBeInstanceOf(SignInError);
    await expect(done).rejects.toMatchObject({ code: 'link-expired' });
  });

  it('ports without an API yet say so', async () => {
    await expect(firstValueFrom(TestBed.inject(UnitDataSource).list(['s-1']))).rejects.toBeInstanceOf(ApiError);
    await expect(firstValueFrom(TestBed.inject(AccessDataSource).directory(null))).rejects.toMatchObject({ kind: 'server' });
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

    const invalid = firstValueFrom(schemes.update('s-1', { name: 'X', code: 'K1', type: 'Sectional Title', suburb: 'a', city: 'b', province: 'Gauteng' }, 1));
    http.expectOne('/api/schemes/s-1').flush({ title: 'Some details need attention', errors: { code: 'Use 2–4 letters' } }, { status: 422, statusText: 'Unprocessable' });
    await expect(invalid).rejects.toMatchObject({ kind: 'validation', fieldErrors: { code: 'Use 2–4 letters' } });

    const stale = firstValueFrom(schemes.update('s-1', { name: 'Kingfisher', code: 'KC', type: 'Sectional Title', suburb: 'a', city: 'b', province: 'Gauteng' }, 1));
    http.expectOne('/api/schemes/s-1').flush({ title: 'Someone else changed this first' }, { status: 409, statusText: 'Conflict' });
    await expect(stale).rejects.toMatchObject({ kind: 'conflict' });
  });
});
