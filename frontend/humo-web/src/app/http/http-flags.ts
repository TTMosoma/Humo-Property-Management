import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpPort } from './http-port';

/** The feature switches for the signed-in person's agency (GET /me/flags): which built screens are on. */
@Injectable()
export class HttpFeatureSwitches extends HttpPort {
  myFlags(): Observable<Record<string, boolean>> {
    return this.live<Record<string, boolean>>('/me/flags', ['session', 'settings']);
  }
}
