import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { OrganisationDocumentSettings, ResolvedBranding, StatementView, TemplateDesign } from '../../domain';
import { API_BASE_URL } from '../../http/http-session-data-source';
import { Logo } from '../../ui/brand/logo';
import { LevyStatementDocument } from './levy-statement/levy-statement-document';

/** What the link says about itself before the code: nothing personal. */
interface LinkInfo {
  kind: 'statement';
  title: string;
  schemeName: string;
  agencyName: string;
  codeChannel: 'sms' | 'email' | null;
  codeSentTo: string | null;
  expiresAt: string;
}

interface StatementSnapshot {
  view: StatementView;
  design: TemplateDesign;
  branding: ResolvedBranding;
  settings: OrganisationDocumentSettings;
  organisationName: string;
}

type Step = 'loading' | 'start' | 'code' | 'view' | 'expired' | 'not-found' | 'no-contact' | 'unavailable';

const RESEND_AFTER_S = 60;

/**
 * A secure document link (`/d/{token}`, docs/18 R-1): an owner opens the statement from their email without a
 * Humo PM account. The link shows only what it is; a one-time code (SMS to the mobile on record, else email)
 * opens it for 30 minutes. Only the production build talks to the API: the simulation sends no statement emails.
 */
@Component({
  selector: 'app-document-link-page',
  imports: [IonIcon, Logo, LevyStatementDocument, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './document-link-page.html',
  styleUrl: './document-link-page.scss',
})
export class DocumentLinkPage {
  private readonly http = inject(HttpClient, { optional: true });
  private readonly base = inject(API_BASE_URL);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';
  private grant = '';
  private timer: ReturnType<typeof setInterval> | undefined;

  protected readonly step = signal<Step>('loading');
  protected readonly info = signal<LinkInfo | null>(null);
  protected readonly sentTo = signal('');
  protected readonly sentBy = signal<'sms' | 'email'>('sms');
  protected readonly code = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly resendIn = signal(0);
  protected readonly statement = signal<StatementSnapshot | null>(null);
  protected readonly downloading = signal(false);
  /** "19 January 2027": the last day the link works. */
  protected readonly until = computed(() => {
    const at = this.info()?.expiresAt;
    return at ? new Date(at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  });

  constructor() {
    if (!this.http) {
      this.step.set('unavailable');
      return;
    }
    this.http.get<LinkInfo>(this.url()).subscribe({
      next: (i) => {
        this.info.set(i);
        this.step.set(i.codeChannel ? 'start' : 'no-contact');
      },
      error: (e: HttpErrorResponse) => this.step.set(e.status === 410 ? 'expired' : e.status === 404 ? 'not-found' : 'unavailable'),
    });
  }

  private url(path = ''): string {
    return `${this.base}/document-links/${encodeURIComponent(this.token)}${path}`;
  }

  private static reason(e: HttpErrorResponse, fallback: string): string {
    return (e.error as { title?: string } | null)?.title ?? fallback;
  }

  protected sendCode(): void {
    if (this.busy() || this.resendIn() > 0) return;
    this.busy.set(true);
    this.error.set('');
    this.http!.post<{ channel: 'sms' | 'email'; sentTo: string }>(this.url('/code'), null).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.sentBy.set(r.channel);
        this.sentTo.set(r.sentTo);
        this.code.set('');
        this.step.set('code');
        this.countdown();
      },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        if (e.status === 410) this.step.set('expired');
        else this.error.set(DocumentLinkPage.reason(e, 'We couldn’t send a code just now. Try again in a few minutes.'));
      },
    });
  }

  private countdown(): void {
    clearInterval(this.timer);
    this.resendIn.set(RESEND_AFTER_S);
    this.timer = setInterval(() => {
      this.resendIn.update((s) => Math.max(0, s - 1));
      if (this.resendIn() === 0) clearInterval(this.timer);
    }, 1000);
  }

  protected setCode(e: Event): void {
    // Digits only, written back at once: a stray letter or space must not take one of the six places.
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    this.code.set(input.value);
    this.error.set('');
  }

  protected verify(): void {
    if (this.busy()) return;
    if (this.code().length !== 6) {
      this.error.set('Enter the 6-digit code.');
      return;
    }
    this.busy.set(true);
    this.http!.post<{ grant: string }>(this.url('/verify'), { code: this.code() }).subscribe({
      next: (r) => {
        this.grant = r.grant;
        this.load();
      },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        if (e.status === 410) this.step.set('expired');
        else this.error.set(DocumentLinkPage.reason(e, 'That code didn’t work. Ask for a new one.'));
      },
    });
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({ 'X-Document-Grant': this.grant });
  }

  private load(): void {
    this.http!.get<StatementSnapshot>(this.url('/document'), { headers: this.headers() }).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.statement.set(s);
        this.step.set('view');
      },
      error: () => {
        this.busy.set(false);
        this.error.set('We couldn’t open the statement. Ask for a new code.');
        this.step.set('start');
      },
    });
  }

  protected download(): void {
    const s = this.statement();
    if (!s || this.downloading()) return;
    this.downloading.set(true);
    this.http!.get(this.url('/pdf'), { headers: this.headers(), responseType: 'blob' }).subscribe({
      next: (blob) => {
        this.downloading.set(false);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${s.view.account.accountNo}-${s.view.statement.period}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      },
      error: (e: HttpErrorResponse) => {
        this.downloading.set(false);
        // The 30-minute viewing time is over: start again with a new code.
        if (e.status === 401) {
          this.statement.set(null);
          this.error.set('Your viewing time is over. Ask for a new code to open it again.');
          this.step.set('start');
        }
      },
    });
  }
}
