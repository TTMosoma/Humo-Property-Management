import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { REPORT_CATEGORIES, ReportDataSource, ReportDef, Scheme } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

const ICON: Record<ReportDef['category'], string> = {
  financial: 'cash-outline',
  arrears: 'wallet-outline',
  maintenance: 'construct-outline',
  governance: 'shield-half-outline',
  portfolio: 'business-outline',
};

/**
 * Reports: one catalogue (review finding F7), grouped by category, showing
 * only the reports this role and plan may run. Also each scheme's Reports tab,
 * where every report opens for that scheme.
 */
@Component({
  selector: 'app-reports-page',
  imports: [PageHeader, ScopeNotice, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!fixedScheme()) {
      <ui-page-header eyebrow="Records" title="Reports" subtitle="Portfolio and scheme reports, worked out from your live records. Open one to filter, print or export it." />
      <app-scope-notice />
    }

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="6" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the reports" (retry)="result.retry()" /></div>
    } @else if (!groups().length) {
      <div class="surface"><ui-empty-state title="No reports for your role" message="Reports appear here when your role and your agency’s plan include them." /></div>
    } @else {
      @for (g of groups(); track g.id) {
        <section class="group">
          <h2 class="g-title">{{ g.label }}</h2>
          <p class="g-desc">{{ g.description }}</p>
          <div class="cards">
            @for (r of g.reports; track r.id) {
              <a class="card surface" [routerLink]="['/reports', r.id]" [queryParams]="fixedScheme() ? { scheme: fixedScheme()!.id } : {}">
                <ion-icon [name]="icon[r.category]" aria-hidden="true" />
                <span class="c-title">{{ r.title }}</span>
                <span class="c-desc">{{ r.description }}</span>
              </a>
            }
          </div>
        </section>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .group { margin-bottom: var(--s-5); }
    .g-title { margin: 0; font-size: var(--fs-md); }
    .g-desc { margin: 2px 0 var(--s-3); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--s-3); }
    .card { display: flex; flex-direction: column; gap: 4px; padding: var(--s-4); color: inherit; text-decoration: none; border: 1px solid var(--c-border); }
    .card:hover { border-color: var(--c-primary); }
    .card ion-icon { font-size: 20px; color: var(--c-primary); }
    .c-title { font-weight: var(--fw-semibold); }
    .c-desc { font-size: var(--fs-sm); color: var(--c-text-2); }
  `,
})
export class ReportsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(ReportDataSource);

  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });
  protected readonly result = loadable(() => this.data.catalogue());
  protected readonly icon = ICON;

  protected readonly groups = computed(() => {
    const reports = this.result.value() ?? [];
    return REPORT_CATEGORIES.map((c) => ({ ...c, reports: reports.filter((r) => r.category === c.id) })).filter((g) => g.reports.length);
  });
}
