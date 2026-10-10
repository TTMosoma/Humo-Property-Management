import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CatalogueService } from '../../core/catalogue/catalogue.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { Opportunity, PlatformCustomer, PlatformDataSource } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { ScoreRing, Sparkline } from '../../ui/charts/charts';
import { formatDate, formatRand } from '../../ui/format/money';
import { relativeTime } from '../../ui/format/relative-time';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { BAND_LABEL, BAND_TONE } from './platform-view';

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
  protected readonly catalogue = inject(CatalogueService);
  private readonly data = inject(PlatformDataSource);
  protected readonly session = inject(SessionService);

  /** One page, five views: portfolio (default), health, subscriptions, opportunities, support. */
  protected readonly view = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('view') ?? 'portfolio')), { initialValue: 'portfolio' });
  protected readonly titles: Record<string, { title: string; sub: string }> = {
    health: { title: 'Account health', sub: 'Your accounts from most to least at risk, with the signal that’s pulling each one down.' },
    subscriptions: { title: 'Subscriptions', sub: 'Packages, add-ons and renewals for your accounts. Open an account to change its features.' },
    opportunities: { title: 'Opportunities', sub: 'Reasons to talk to a customer — from their own usage. Not a sales list.' },
    support: { title: 'Support & requests', sub: 'Open tickets, escalations and upgrade requests across your accounts.' },
  };

  protected readonly result = loadable(() => this.data.customers().pipe(map((p) => ({ all: p.items }))));
  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;

  /** My book: the accounts I look after. */
  protected readonly mine = computed(() =>
    ((this.result.value()?.all ?? [])).filter((c) => c.accountManagerId === this.session.actor().id),
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
        const what = r.addOn ? `${this.catalogue.addOnName(r.addOn)} add-on` : r.package ? this.catalogue.packageName(r.package) : 'an upgrade';
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

  protected readonly renewals = computed(() =>
    [...this.mine()].sort((a, b) => a.subscription.renewsAt.localeCompare(b.subscription.renewsAt)),
  );

  protected readonly allOpportunities = computed(() => {
    const rank = { high: 0, medium: 1, low: 2 };
    return this.mine()
      .flatMap((c) => c.opportunities.map((o) => ({ c, o })))
      .sort((a, b) => rank[a.o.strength] - rank[b.o.strength] || b.o.potentialMrr - a.o.potentialMrr);
  });

  protected readonly tickets = computed(() =>
    this.mine()
      .flatMap((c) => c.tickets.map((t) => ({ c, t })))
      .sort((a, b) => (a.t.severity === b.t.severity ? a.t.openedAt.localeCompare(b.t.openedAt) : a.t.severity === 'critical' ? -1 : 1)),
  );
  protected readonly requests = computed(() => this.mine().flatMap((c) => c.requests.map((r) => ({ c, r }))));

  protected weakest(c: PlatformCustomer) {
    return [...c.health.signals].sort((a, b) => a.score - b.score)[0];
  }

  protected renewsSoon(c: PlatformCustomer): boolean {
    return new Date(c.subscription.renewsAt).getTime() < Date.now() + 90 * DAY;
  }

  protected addOnNames(c: PlatformCustomer): string {
    return c.subscription.addOns.map((a) => this.catalogue.addOnName(a.addOnId)).join(', ');
  }

  protected readonly relativeTime = relativeTime;
  protected readonly bandLabel = BAND_LABEL;
  protected readonly bandTone = BAND_TONE;
  protected readonly shortPackage = this.catalogue.shortPackage;
  protected readonly formatDate = formatDate;
  protected readonly rand = (n: number, compact = false) => formatRand(n, { compact, cents: false });

  protected oppTitle(o: Opportunity): string {
    return o.target.addOn ? this.catalogue.addOnName(o.target.addOn) : o.title;
  }

  protected adoptionOf(c: PlatformCustomer): number {
    return c.health.signals.find((s) => s.key === 'adoption')?.score ?? 0;
  }
}
