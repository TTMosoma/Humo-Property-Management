import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError, LibraryDataSource, PolicyError, RuleAction, RulesDataSource, todaySA } from '../../domain';
import { AccessStore } from '../db/access-store';
import { LibraryStore } from '../db/library-store';
import { RulesStore } from '../db/rules-store';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

describe('Scheme rules: registered rules PDF', () => {
  let auth: MockAuthSession;
  let rules: RulesDataSource;
  let store: RulesStore;
  let library: LibraryStore;
  let access: AccessStore;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const KC = 'kingfisher-court';
  const today = todaySA();
  const pdf = (name = 'kc-conduct-rules.pdf') => new File(['%PDF-1.7 rules'], name, { type: 'application/pdf' });
  const upload = (over: Partial<Extract<RuleAction, { type: 'upload' }>> = {}, file = pdf()) =>
    run(rules.actRules(KC, { type: 'upload', fileName: file.name, mimeType: file.type, sizeBytes: file.size, adoptedOn: '2024-03-01', resolutionRef: 'Registered with the CSOS', shareWithOwners: true, ...over }, file));

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    // jsdom has no object URLs for files; the browser does (the library uses one to open the PDF).
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rules-pdf');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    rules = TestBed.inject(RulesDataSource);
    store = TestBed.inject(RulesStore);
    library = TestBed.inject(LibraryStore);
    access = TestBed.inject(AccessStore);
    auth.signIn('p-thandeka'); // Agency Administrator: Meetings.Manage
  });

  it('uploads the PDF to Documents, shares it with owners, and replaces their earlier copy', async () => {
    const before = store.book(KC).shared?.documentId;
    const id = (await upload()) as string;
    const doc = library.documents.find((d) => d.id === id)!;
    expect(doc).toMatchObject({ category: 'rules', visibility: 'owners', mimeType: 'application/pdf', fileName: 'kc-conduct-rules.pdf' });
    expect(library.contentUrl(id)).toBeTruthy();
    const book = store.book(KC);
    expect(book.sources?.[0]).toMatchObject({ documentId: id, adoptedOn: '2024-03-01', resolutionRef: 'Registered with the CSOS', shared: true });
    expect(book.shared?.documentId).toBe(id);
    if (before) expect(library.documents.find((d) => d.id === before)?.archived).toBeTruthy();
    expect(access.audit()[0].action).toContain('Uploaded the registered rules PDF');
  });

  it('owners see the shared PDF in their documents', async () => {
    const id = (await upload()) as string;
    auth.signIn('p-anele'); // owner at Kingfisher Court
    const mine = await run(TestBed.inject(LibraryDataSource).mine());
    expect(mine.some((d) => d.id === id)).toBe(true);
  });

  it('keeps earlier versions on record, newest first', async () => {
    const first = (await upload()) as string;
    const second = (await upload({ adoptedOn: today, resolutionRef: 'AGM special resolution RES-KC-21' }, pdf('kc-rules-2026.pdf'))) as string;
    const book = store.book(KC);
    expect(book.sources?.map((s) => s.documentId)).toEqual([second, first]);
    expect(library.documents.find((d) => d.id === first)?.archived).toBeTruthy();
  });

  it('a staff-only upload leaves the owners’ copy in place', async () => {
    const shared = (await upload()) as string;
    const draft = (await upload({ shareWithOwners: false, adoptedOn: today }, pdf('draft.pdf'))) as string;
    expect(library.documents.find((d) => d.id === draft)?.visibility).toBe('staff');
    expect(store.book(KC).shared?.documentId).toBe(shared);
    expect(library.documents.find((d) => d.id === shared)?.archived).toBeFalsy();
  });

  it('refuses a non-PDF, a future date and a missing adoption note', async () => {
    const txt = new File(['rules'], 'rules.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    await expect(upload({}, txt)).rejects.toBeInstanceOf(ApiError);
    await expect(upload({ adoptedOn: '2999-01-01' })).rejects.toBeInstanceOf(ApiError);
    await expect(upload({ resolutionRef: '' })).rejects.toBeInstanceOf(ApiError);
  });

  it('adding register rules after sharing the PDF doesn’t nag to share again', async () => {
    await upload();
    await run(rules.actRules(KC, { type: 'add', number: '99.1', title: 'Drone flying', category: 'safety', text: 'No drones may be flown over the common property without the trustees’ consent.', resolutionId: '' }));
    expect(store.book(KC).changedSinceShared).toBe(false);
  });

  it('needs Meetings.Manage', async () => {
    auth.signIn('p-priya'); // Finance: no Meetings.Manage
    await expect(upload()).rejects.toBeInstanceOf(PolicyError);
  });
});
