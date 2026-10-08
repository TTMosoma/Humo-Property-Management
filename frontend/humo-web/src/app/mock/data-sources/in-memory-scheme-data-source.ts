import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Scheme, SchemeDataSource, SchemeHealth } from '../../domain';
import { AccessStore } from '../db/access-store';
import { SCHEME_HEALTH } from '../fixtures/scheme-health';
import { SCHEMES } from '../fixtures/schemes';
import { portfolioManagerOf } from '../fixtures/staff';
import { mockResponder } from '../mock-latency';

@Injectable()
export class InMemorySchemeDataSource extends SchemeDataSource {
  private readonly respond = mockResponder();
  private readonly access = inject(AccessStore);

  /** The server joins the manager in from role assignments. */
  private withManager(s: Scheme): Scheme {
    return { ...s, portfolioManager: portfolioManagerOf(s.id, this.access.identities()) };
  }

  list(): Observable<Scheme[]> {
    return this.respond(SCHEMES.map((s) => this.withManager(s)));
  }

  get(id: string): Observable<Scheme | undefined> {
    const s = SCHEMES.find((x) => x.id === id);
    return this.respond(s ? this.withManager(s) : undefined);
  }

  health(): Observable<SchemeHealth[]> {
    return this.respond(SCHEME_HEALTH);
  }
}
