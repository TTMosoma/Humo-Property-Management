import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { OrganisationDocumentSettings, ResolvedBranding, StatementView, TemplateDesign } from '../../domain';
import { API_BASE_URL } from '../../http/http-session-data-source';
import { LevyStatementDocument } from './levy-statement/levy-statement-document';

/** An issued statement's snapshot (D7), exactly as the API stored it. */
interface StatementSnapshot {
  view: StatementView;
  design: TemplateDesign;
  branding: ResolvedBranding;
  settings: OrganisationDocumentSettings;
  organisationName: string;
}

/**
 * The print route (D8): headless Chromium on the server opens /print/statement/{token} and prints this
 * page to PDF. It draws only the stored snapshot (data, design, branding, contact details), never
 * today's records, with the same layout people see on screen. No session: the short-lived token is the
 * only way in. `data-print-ready` tells the renderer the document and its fonts are in place.
 */
@Component({
  selector: 'app-print-statement-page',
  imports: [LevyStatementDocument],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (snapshot(); as s) {
      <app-levy-statement-document [view]="s.view" [design]="s.design" [branding]="s.branding" [settings]="s.settings" [organisationName]="s.organisationName" />
    }
    @if (ready()) {
      <span data-print-ready hidden></span>
    }
    @if (failed()) {
      <span data-print-ready data-print-error hidden></span>
      <p>This document link has expired.</p>
    }
  `,
  styles: `
    :host {
      display: block;
      background: #fff;
    }
  `,
})
export class PrintStatementPage {
  // Only the production build talks to the API; the simulation has no print route to serve.
  private readonly http = inject(HttpClient, { optional: true });
  private readonly base = inject(API_BASE_URL);
  private readonly injector = inject(Injector);

  protected readonly snapshot = signal<StatementSnapshot | null>(null);
  protected readonly ready = signal(false);
  protected readonly failed = signal(false);

  constructor() {
    const token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';
    if (!this.http) {
      this.failed.set(true);
      return;
    }
    this.http.get<StatementSnapshot>(`${this.base}/print/statements/${encodeURIComponent(token)}`).subscribe({
      next: (s) => {
        this.snapshot.set(s);
        // Once drawn, wait for the web fonts too: a PDF printed before they load uses fallbacks.
        afterNextRender(() => void document.fonts.ready.then(() => this.ready.set(true)), { injector: this.injector });
      },
      error: () => this.failed.set(true),
    });
  }
}
