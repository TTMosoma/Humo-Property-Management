import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Scheme, SchemeDataSource } from '../../domain';
import { SCHEMES } from '../fixtures/schemes';
import { mockResponder } from '../mock-latency';

@Injectable()
export class InMemorySchemeDataSource extends SchemeDataSource {
  private readonly respond = mockResponder();

  list(): Observable<Scheme[]> {
    return this.respond(SCHEMES);
  }

  get(id: string): Observable<Scheme | undefined> {
    return this.respond(SCHEMES.find((s) => s.id === id));
  }
}
