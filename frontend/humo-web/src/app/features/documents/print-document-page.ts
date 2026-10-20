import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CollectionStep, CollectionView, OrganisationDocumentSettings, ResolvedBranding, StatementView, TemplateDesign } from '../../domain';
import { API_BASE_URL } from '../../http/http-session-data-source';
import { LevyStatementDocument } from './levy-statement/levy-statement-document';
import { PaymentNoticeDocument } from './payment-notice/payment-notice-document';

/** An issued document's snapshot (D7), exactly as the API stored it. */
interface Snapshot {
  design: TemplateDesign;
  branding: ResolvedBranding;
  settings: OrganisationDocumentSettings;
}

interface StatementSnapshot extends Snapshot {
  view: StatementView;
  organisationName: string;
}

interface LetterSnapshot extends Snapshot {
  view: CollectionView;
  step: CollectionStep;
}

/** Which documents have a print route: route data `kind` → the API's print endpoint. */
const ENDPOINTS = { statement: 'statements', letter: 'letters' } as const;
type PrintKind = keyof typeof ENDPOINTS;

/**
 * The print routes (D8): headless Chromium on the server opens /print/statement/{token} or
 * /print/letter/{token} and prints this page to PDF. It draws only the stored snapshot (data, design,
 * branding, contact details), never today's records, with the same layouts people see on screen.
 * No session: the short-lived token is the only way in. `data-print-ready` tells the renderer the
 * document and its fonts are in place.
 */
@Component({
  selector: 'app-print-document-page',
  imports: [LevyStatementDocument, PaymentNoticeDocument],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (statement(); as s) {
      <app-levy-statement-document [view]="s.view" [design]="s.design" [branding]="s.branding" [settings]="s.settings" [organisationName]="s.organisationName" />
    }
    @if (letter(); as l) {
      <app-payment-notice-document [view]="l.view" [step]="l.step" [design]="l.design" [branding]="l.branding" [settings]="l.settings" />
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
export class PrintDocumentPage {
  // Only the production build talks to the API; the simulation has no print route to serve.
  private readonly http = inject(HttpClient, { optional: true });
  private readonly base = inject(API_BASE_URL);
  private readonly injector = inject(Injector);

  protected readonly statement = signal<StatementSnapshot | null>(null);
  protected readonly letter = signal<LetterSnapshot | null>(null);
  protected readonly ready = signal(false);
  protected readonly failed = signal(false);

  constructor() {
    const route = inject(ActivatedRoute).snapshot;
    const kind = route.data['kind'] as PrintKind;
    const token = route.paramMap.get('token') ?? '';
    if (!this.http || !ENDPOINTS[kind]) {
      this.failed.set(true);
      return;
    }
    this.http.get<StatementSnapshot & LetterSnapshot>(`${this.base}/print/${ENDPOINTS[kind]}/${encodeURIComponent(token)}`).subscribe({
      next: (s) => {
        if (kind === 'letter') this.letter.set(s);
        else this.statement.set(s);
        // Once drawn, wait for the web fonts too: a PDF printed before they load uses fallbacks.
        afterNextRender(() => void document.fonts.ready.then(() => this.ready.set(true)), { injector: this.injector });
      },
      error: () => this.failed.set(true),
    });
  }
}
