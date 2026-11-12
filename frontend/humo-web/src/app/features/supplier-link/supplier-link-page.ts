import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { SupplierLinkDataSource, describeFailure, fieldErrorsOf } from '../../domain';
import { formatDate, formatRand } from '../../ui/format/money';

/**
 * D38: Humo Contractor's page for one quote request or work order, opened from the supplier's email. No sign-in, and
 * nothing about the residents: the work, the photos, and what the supplier can do next.
 */
@Component({
  selector: 'app-supplier-link-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <header class="brand">
        <span class="mark">Humo Contractor</span>
        @if (view(); as v) { <span class="from">from {{ v.agency }}</span> }
      </header>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (!view()) {
        <section class="card">
          <h1>This link isn’t valid</h1>
          <p>It may have been replaced by a newer one. Check your latest email, or ask the managing agent to send it again.</p>
        </section>
      } @else {
        @let v = view()!;
        <section class="card">
          <p class="eyebrow">{{ v.kind === 'quote' ? 'Quote request' : 'Work order' }} · {{ v.jobRef }} · {{ v.category }}</p>
          <h1>{{ v.title }}</h1>
          <p class="muted">For {{ v.supplier }} · {{ v.scheme }}, {{ v.area }}</p>
          @if (v.where) { <p><strong>Where:</strong> {{ v.where }}</p> }
          @if (v.description) { <p class="desc">{{ v.description }}</p> }

          @if (v.photos.length) {
            <div class="photos">
              @for (p of v.photos; track p.id) {
                @if (photoUrl(p.id); as url) {
                  <a [href]="url" target="_blank" rel="noopener"><img [src]="url" [alt]="p.caption" loading="lazy" /></a>
                }
              }
            </div>
          }
        </section>

        @if (done()) {
          <section class="card done">
            <h2>{{ done() }}</h2>
            <p>The managing agent has been told. You can come back to this link while it’s open.</p>
            <div class="promo">
              <strong>Coming soon: a free Humo Contractor account.</strong>
              Every quote request from every agency in one place, your details saved, and when you’ll be paid.
            </div>
          </section>
        } @else if (!v.open) {
          <section class="card closed">
            <h2>{{ v.closedReason }}</h2>
            @if (v.quote?.amount !== undefined && v.quote?.amount !== null) { <p>Your quote: {{ rand(v.quote!.amount!) }}</p> }
          </section>
        } @else if (v.kind === 'quote') {
          <section class="card">
            <h2>{{ v.quote?.status === 'received' ? 'Revise your quote' : v.quote?.status === 'revision-requested' ? 'Send a revised quote' : 'Send your quote' }}</h2>
            @if (v.quote?.status === 'received') { <p class="muted">Your quote: {{ rand(v.quote!.amount!) }}. You can revise it until it’s decided.</p> }
            @if (v.quote?.rejectedReason) { <p class="muted">Feedback on your last quote: “{{ v.quote!.rejectedReason }}”</p> }
            <form (submit)="$event.preventDefault(); sendQuote()">
              <label>Your price, including VAT if you charge it (R)
                <input type="number" min="0" step="0.01" required [value]="amount()" (input)="amount.set($any($event.target).value)" />
                @if (errors()['amount']) { <span class="error" role="alert">{{ errors()['amount'] }}</span> }
              </label>
              <label>Guarantee (months, optional)
                <input type="number" min="0" max="120" [value]="guarantee()" (input)="guarantee.set($any($event.target).value)" />
              </label>
              <label>Notes (optional)
                <textarea rows="3" [value]="notes()" (input)="notes.set($any($event.target).value)" placeholder="What’s included, how long it takes, anything to know"></textarea>
              </label>
              <label>Your quote as a PDF (optional)
                <input type="file" accept=".pdf" (change)="file.set($any($event.target).files?.[0])" />
                @if (errors()['file']) { <span class="error" role="alert">{{ errors()['file'] }}</span> }
              </label>
              @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
              <div class="actions">
                <button type="submit" class="primary" [disabled]="busy()">{{ v.quote?.status === 'received' ? 'Send revised quote' : 'Send quote' }}</button>
                <button type="button" class="ghost" [disabled]="busy()" (click)="declining.set(!declining())">Can’t quote</button>
              </div>
            </form>
            @if (declining()) {
              <form class="decline" (submit)="$event.preventDefault(); decline()">
                <label>Why not? (optional)
                  <input type="text" [value]="reason()" (input)="reason.set($any($event.target).value)" placeholder="e.g. Fully booked this month" />
                </label>
                <button type="submit" class="ghost" [disabled]="busy()">Decline to quote</button>
              </form>
            }
          </section>
        } @else {
          <section class="card">
            <h2>Booked for {{ date(v.workOrder!.scheduledFor) }}</h2>
            @if (v.workOrder!.accessNotes) { <p><strong>Access:</strong> {{ v.workOrder!.accessNotes }}</p> }
            @if (v.workOrder!.confirmedAt) { <p class="ok">You confirmed this date.</p> }
            @if (v.workOrder!.askedFor) { <p class="muted">You asked to come on {{ date(v.workOrder!.askedFor!) }} instead.</p> }
            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
            <div class="actions">
              <button type="button" class="primary" [disabled]="busy()" (click)="confirm()">Confirm this date</button>
              <button type="button" class="ghost" [disabled]="busy()" (click)="rescheduling.set(!rescheduling())">Ask for another date</button>
            </div>
            @if (rescheduling()) {
              <form class="decline" (submit)="$event.preventDefault(); reschedule()">
                <label>The day you can come
                  <input type="date" required [value]="newDate()" (input)="newDate.set($any($event.target).value)" />
                  @if (errors()['date']) { <span class="error" role="alert">{{ errors()['date'] }}</span> }
                </label>
                <label>Note (optional)
                  <input type="text" [value]="reason()" (input)="reason.set($any($event.target).value)" />
                </label>
                <button type="submit" class="ghost" [disabled]="busy()">Send</button>
              </form>
            }
          </section>
        }
        <p class="foot">This page is for {{ v.supplier }} only. Please don’t forward the link.</p>
      }
    </main>
  `,
  styles: `
    /* Ionic fixes ion-app to the window with overflow hidden, so this page is its own scroll area (as the statement link). */
    :host { display: block; height: 100%; overflow-y: auto; overscroll-behavior: contain; background: var(--c-bg, #f5f6f8); color: var(--c-text, #111); }
    .page { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
    .brand { display: flex; align-items: baseline; gap: 10px; margin-bottom: 16px; }
    .mark { font-weight: 700; font-size: 18px; }
    .from, .muted, .foot { color: var(--c-text-muted, #5b6472); }
    .card { margin-bottom: 16px; padding: 20px; background: var(--c-surface, #fff); border: 1px solid var(--c-border, #e2e5ea); border-radius: 12px; }
    .eyebrow { margin: 0 0 4px; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--c-text-muted, #5b6472); }
    h1 { margin: 0 0 6px; font-size: 24px; }
    h2 { margin: 0 0 10px; font-size: 18px; }
    .desc { white-space: pre-line; }
    .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 12px; }
    .photos img { width: 100%; height: 110px; object-fit: cover; border-radius: 8px; }
    form { display: grid; gap: 12px; }
    label { display: grid; gap: 4px; font-size: 14px; }
    input, textarea { padding: 8px 10px; font: inherit; border: 1px solid var(--c-border, #c9ced6); border-radius: 8px; background: var(--c-surface, #fff); color: inherit; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    button { padding: 9px 16px; font: inherit; border-radius: 8px; cursor: pointer; }
    .primary { color: var(--c-on-primary, #fff); background: var(--c-primary, #0f2a43); border: 0; }
    .primary:hover:not(:disabled) { background: var(--c-primary-hover, #0f2a43); }
    button:disabled { opacity: 0.6; cursor: default; }
    .ghost { background: none; border: 1px solid var(--c-border, #c9ced6); color: inherit; }
    .decline { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--c-border, #e2e5ea); }
    .error { color: #b42318; font-size: 13px; }
    .ok { color: #067647; }
    .promo { margin-top: 12px; padding: 12px; background: var(--c-surface-sunken, #eef2f6); border-radius: 8px; }
    .foot { margin-top: 24px; font-size: 13px; }
  `,
})
export class SupplierLinkPage {
  private readonly data = inject(SupplierLinkDataSource);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  private readonly reload = signal(0);
  private readonly loaded = toSignal(
    toObservable(this.reload).pipe(switchMap(() => this.data.view(this.token).pipe(map((v) => ({ v })), catchError(() => of({ v: undefined }))))),
  );
  protected readonly loading = computed(() => this.loaded() === undefined);
  protected readonly view = computed(() => this.loaded()?.v);

  protected readonly amount = signal('');
  protected readonly guarantee = signal('');
  protected readonly notes = signal('');
  protected readonly file = signal<File | undefined>(undefined);
  protected readonly reason = signal('');
  protected readonly newDate = signal('');
  protected readonly declining = signal(false);
  protected readonly rescheduling = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly done = signal<string | null>(null);

  protected photoUrl(id: string): string | undefined {
    return this.data.photoUrl(this.token, id);
  }

  protected rand(n: number): string {
    return formatRand(n);
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected sendQuote(): void {
    const g = this.guarantee().trim();
    this.run(
      this.data.quote(this.token, { amount: Number(this.amount()), guaranteeMonths: g ? Number(g) : undefined, notes: this.notes().trim() || undefined }, this.file()),
      'Your quote has been sent',
    );
  }

  protected decline(): void {
    this.run(this.data.decline(this.token, this.reason().trim()), 'You’ve declined to quote');
  }

  protected confirm(): void {
    this.run(this.data.confirm(this.token), 'Thanks: the date is confirmed');
  }

  protected reschedule(): void {
    this.run(this.data.reschedule(this.token, this.newDate(), this.reason().trim()), 'Your request for another date has been sent');
  }

  private run(call: Observable<void>, success: string): void {
    this.busy.set(true);
    this.error.set(null);
    this.errors.set({});
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.done.set(success);
        this.reload.update((n) => n + 1);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.errors.set(fieldErrorsOf(e));
        this.error.set(Object.keys(fieldErrorsOf(e)).length ? null : describeFailure(e, 'It wasn’t sent'));
      },
    });
  }
}

