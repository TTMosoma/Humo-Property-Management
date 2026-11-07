import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { PastHome, PastResidentDataSource, PastStatement } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

const HOME_LABEL: Record<PastHome['type'], string> = { owner: 'Owner', tenant: 'Tenant', trustee: 'Trustee' };

/**
 * D33: home for someone with no property left at this agency. It says so plainly, who to contact if
 * that's wrong, and what's still theirs: their past statements, read-only, and their profile.
 */
@Component({
  selector: 'app-past-resident-page',
  imports: [PageHeader, RouterLink, IonIcon, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Welcome" [title]="'Hello, ' + firstName()" subtitle="You don’t have any property registered under your name at the moment." />

    @switch (data.status()) {
      @case ('loading') {
        <ui-skeleton [count]="3" />
      }
      @case ('error') {
        <div class="surface"><ui-error-state title="We couldn’t load your details" (retry)="data.retry()" /></div>
      }
      @default {
        @if (data.value(); as v) {
          <section class="surface block">
            <h2>If this looks wrong</h2>
            <p>This usually means a sale or a transfer has been recorded. If it’s a mistake, contact {{ v.agency.name }}.</p>
            @if (v.agency.email || v.agency.phone) {
              <p class="contact">
                @if (v.agency.email) { <a [href]="'mailto:' + v.agency.email"><ion-icon name="mail-outline" aria-hidden="true" /> {{ v.agency.email }}</a> }
                @if (v.agency.phone) { <a [href]="'tel:' + v.agency.phone"><ion-icon name="call-outline" aria-hidden="true" /> {{ v.agency.phone }}</a> }
              </p>
            }
          </section>

          @if (v.statements.length) {
            <section class="surface block">
              <h2>Your past statements</h2>
              <ul class="list">
                @for (s of v.statements; track s.accountId + s.period) {
                  <li>
                    <span><strong>{{ s.periodLabel }}</strong> · {{ s.scheme }}, Unit {{ s.unit }}@if (!s.issuedOn) { <span class="muted"> · not sent at the time</span> }</span>
                    @if (pdfUrl(s); as url) { <a class="btn btn-secondary btn-sm" [href]="url" target="_blank" rel="noopener"><ion-icon name="download-outline" aria-hidden="true" /> PDF</a> }
                  </li>
                }
              </ul>
            </section>
          }

          @if (v.homes.length) {
            <section class="surface block">
              <h2>What you used to hold</h2>
              <ul class="list">
                @for (h of v.homes; track $index) {
                  <li>
                    <span><strong>{{ homeLabel[h.type] }}</strong> · {{ h.scheme }}@if (h.unit) {, Unit {{ h.unit }} }</span>
                    <span class="muted">{{ formatDate(h.since) }}@if (h.until) { to {{ formatDate(h.until) }} }</span>
                  </li>
                }
              </ul>
            </section>
          }

          <p class="muted">You can still update <a routerLink="/settings/profile">your profile</a>.</p>
        }
      }
    }
  `,
  styles: `
    .block { padding: var(--s-5); margin-bottom: var(--s-4); }
    h2 { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    p { margin: 0; }
    .contact { display: flex; flex-wrap: wrap; gap: var(--s-4); margin-top: var(--s-3); }
    .contact a { display: inline-flex; align-items: center; gap: var(--s-2); }
    .list { margin: 0; padding: 0; list-style: none; }
    .list li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); }
    .list li:last-child { border-bottom: 0; }
    .muted { color: var(--c-text-muted); font-size: var(--fs-sm); }
  `,
})
export class PastResidentPage {
  private readonly session = inject(SessionService);
  private readonly source = inject(PastResidentDataSource);

  protected readonly data = loadable(() => this.source.view());
  protected readonly firstName = computed(() => this.session.identity().name.split(' ')[0]);
  protected readonly homeLabel = HOME_LABEL;
  protected readonly formatDate = formatDate;

  protected pdfUrl(statement: PastStatement): string | undefined {
    return this.source.pdfUrl(statement);
  }
}
