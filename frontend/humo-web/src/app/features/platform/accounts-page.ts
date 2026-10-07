import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of } from 'rxjs';
import { ADD_ONS, Opportunity, PlatformCustomer, PlatformDataSource, packageById } from '../../domain';
import { pageState } from '../../core/prototype/page-state';
import { SessionService } from '../../core/session/session.service';
import { ScoreRing, Sparkline } from '../../ui/charts/charts';
import { formatDate, formatRand } from '../../ui/format/money';
import { relativeTime } from '../../ui/format/relative-time';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { BAND_LABEL, BAND_TONE, shortPackage } from './platform-view';

const DAY = 86_400_000;

/**
 * Humo Account Manager — "My accounts". Customer-focused and operational:
 * who asked for something, who is slipping, who would benefit from a
 * conversation, and what renews soon. Ordered by what needs a human first.
 */
@Component({
  selector: 'app-accounts-page',
  imports: [PageHeader, ScoreRing, Sparkline, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './accounts-page.html',
  styleUrl: './accounts-page.scss',
})
export class AccountsPage {
  private readonly data = inject(PlatformDataSource);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();

  private readonly result = toSignal(
    this.data.customers().pipe(
      map((all) => ({ all, failed: false })),
      catchError(() => of({ all: [] as PlatformCustomer[], failed: true })),
    ),
  );
  protected readonly loading = computed(() => this.page.status() === 'loading' || this.result() === undefined);
  protected readonly failed = computed(() => this.page.status() === 'error' || !!this.result()?.failed);

  /** My book: the accounts I look after. */
  protected readonly mine = computed(() =>
    (this.page.forceEmpty() ? [] : (this.result()?.all ?? [])).filter((c) => c.accountManagerId === this.session.actor().id),
  );

  protected readonly summary = computed(() => {
    const m = this.mine();
    const soon = Date.now() + 90 * DAY;
    return {
      accounts: m.length,
      mrr: m.reduce((n, c) => n + c.subscription.mrr, 0),
      avgHealth: m.length ? Math.round(m.reduce((n, c) => n + c.health.score, 0) / m.length) : 0,
      adoption: m.length ? Math.round(m.reduce((n, c) => n + (c.health.signals.find((s) => s.key === 'adoption')?.score ?? 0), 0) / m.length) : 0,
      renewals: m.filter((c) => new Date(c.subscription.renewsAt).getTime() < soon).length,
      requests: m.flatMap((c) => c.requests).filter((r) => r.status === 'new').length,
    };
  });

  /** Things only a person can do: answer requests, catch slipping accounts. */
  protected readonly needsYou = computed(() => {
    const items: { c: PlatformCustomer; icon: string; title: string; detail: string; tone: 'info' | 'warning' | 'danger' }[] = [];
    for (const c of this.mine()) {
      for (const r of c.requests.filter((x) => x.status === 'new')) {
        const what = r.addOn ? `${ADD_ONS.find((a) => a.id === r.addOn)?.name} add-on` : r.package ? packageById(r.package).name : 'an upgrade';
        items.push({ c, icon: 'hand-right-outline', title: `${c.name} asked about ${what}`, detail: `${r.requestedBy} · ${relativeTime(r.at)}${r.note ? ` · “${r.note}”` : ''}`, tone: 'info' });
      }
      const h = c.health.history;
      const drop = h.length > 4 ? h[h.length - 5] - c.health.score : 0;
      if (c.health.band !== 'healthy' || drop >= 8) {
        const weakest = [...c.health.signals].sort((a, b) => a.score - b.score)[0];
        items.push({
          c,
          icon: c.health.band === 'critical' ? 'alert-circle-outline' : 'trending-down-outline',
          title: `${c.name} — health ${c.health.score}${drop >= 8 ? `, down ${drop} in a month` : ''}`,
          detail: `Weakest: ${weakest.label.toLowerCase()} (${weakest.detail})`,
          tone: c.health.band === 'critical' ? 'danger' : 'warning',
        });
      }
    }
    const order = { info: 0, danger: 1, warning: 2 };
    return items.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 8);
  });

  protected readonly conversations = computed(() =>
    this.mine()
      .flatMap((c) => c.opportunities.filter((o) => o.kind !== 'adoption' && o.strength !== 'low').map((o) => ({ c, o })))
      .sort((a, b) => (a.o.strength === b.o.strength ? b.o.potentialMrr - a.o.potentialMrr : a.o.strength === 'high' ? -1 : 1))
      .slice(0, 6),
  );

  protected readonly accounts = computed(() => [...this.mine()].sort((a, b) => a.health.score - b.health.score));

  protected readonly bandLabel = BAND_LABEL;
  protected readonly bandTone = BAND_TONE;
  protected readonly shortPackage = shortPackage;
  protected readonly formatDate = formatDate;
  protected readonly rand = (n: number, compact = false) => formatRand(n, { compact, cents: false });

  protected oppTitle(o: Opportunity): string {
    return o.target.addOn ? `${ADD_ONS.find((a) => a.id === o.target.addOn)?.name}` : o.title;
  }

  protected adoptionOf(c: PlatformCustomer): number {
    return c.health.signals.find((s) => s.key === 'adoption')?.score ?? 0;
  }
}
