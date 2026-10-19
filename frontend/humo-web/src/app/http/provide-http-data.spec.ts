import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AccessDataSource, ApiError, SchemeDataSource, SessionDataSource, SignInError } from '../domain';
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
    await expect(firstValueFrom(TestBed.inject(SchemeDataSource).list())).rejects.toBeInstanceOf(ApiError);
    await expect(firstValueFrom(TestBed.inject(AccessDataSource).directory(null))).rejects.toMatchObject({ kind: 'server' });
  });
});
