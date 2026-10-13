import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError, PlatformTemplateDataSource, PolicyError, templateVersion, todaySA } from '../../domain';
import { AccessStore } from '../db/access-store';
import { DocumentStore } from '../db/document-store';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

/** D12: custom templates are Humo-owned; Humo publishes a version only with the client's proof approval. */
describe('Custom templates are Humo-owned (D12)', () => {
  let auth: MockAuthSession;
  let platform: PlatformTemplateDataSource;
  let docs: DocumentStore;
  let access: AccessStore;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const ID = 'acacia.levy-statement';
  const today = todaySA();

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    platform = TestBed.inject(PlatformTemplateDataSource);
    docs = TestBed.inject(DocumentStore);
    access = TestBed.inject(AccessStore);
  });

  const current = () => docs.template(ID)!;
  const design = () => templateVersion(current())!.design;

  it('a Humo Account Manager publishes a version with the client’s approval, recorded and audited', async () => {
    auth.signIn('p-dumisani');
    const before = current().currentVersion;
    const n = await run(platform.publishCustomVersion(ID, { ...design(), title: 'Statement of account' }, 'New title from the client brief', { approvedBy: 'Thandeka Mokoena, Agency Administrator', approvedOn: today }, current().version));
    expect(n).toBe(before + 1);
    const v = current().versions.find((x) => x.version === n)!;
    expect(v).toMatchObject({ status: 'published', clientApproval: { approvedBy: 'Thandeka Mokoena, Agency Administrator', approvedOn: today } });
    expect(access.audit()[0].action).toContain('client approval: Thandeka Mokoena');
  });

  it('refuses to publish without the client’s approval', async () => {
    auth.signIn('p-dumisani');
    const before = current().currentVersion;
    await expect(run(platform.publishCustomVersion(ID, design(), 'Tweak', { approvedBy: '', approvedOn: today }, current().version))).rejects.toBeInstanceOf(ApiError);
    await expect(run(platform.publishCustomVersion(ID, design(), 'Tweak', { approvedBy: 'Thandeka', approvedOn: '2999-01-01' }, current().version))).rejects.toBeInstanceOf(ApiError);
    expect(current().currentVersion).toBe(before);
  });

  it('the agency’s own administrator can no longer publish it', async () => {
    auth.signIn('p-thandeka');
    await expect(run(platform.publishCustomVersion(ID, design(), 'Our own change', { approvedBy: 'Thandeka', approvedOn: today }, current().version))).rejects.toBeInstanceOf(PolicyError);
  });
});
