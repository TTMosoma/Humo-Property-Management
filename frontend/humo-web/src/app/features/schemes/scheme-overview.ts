import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { Scheme, SchemeDataSource, SchemeHealth, UnitDataSource, UnitSummary, Urgency, WorkItem, urgencyOf } from '../../domain';
import { SessionService } from '../../core/session/session.service';
import { AttentionService } from '../../core/attention/attention.service';
import { loadable } from '../../core/data/loadable';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { RandPipe, formatDate } from '../../ui/format/money';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { WorkItemPreview } from '../my-work/work-item-preview';
import { AREA_ICON, URGENCY_LABEL, URGENCY_ORDER, URGENCY_TONE, workItemView } from '../my-work/work-item-view';
import { COMPLIANCE, collectionTone } from './scheme-view';

/**
 * Scheme › Overview: "understand this scheme's health immediately" and act on
 * what needs attention without leaving the scheme.
 */
@Component({
  selector: 'app-scheme-overview',
  imports: [IonIcon, StatusPill, EmptyState, ErrorState, Skeleton, RandPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scheme-overview.html',
  styleUrl: './scheme-overview.scss',
})
export class SchemeOverview {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(SchemeDataSource);
  private readonly attention = inject(AttentionService);
  private readonly drawer = inject(DrawerService);
  protected readonly session = inject(SessionService);
  private readonly unitData = inject(UnitDataSource);

  protected readonly scheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme,
  });

  /** Health figures are optional here: if they fail, the rest of the overview still works. */
  protected readonly healthLoad = loadable(() => this.data.health());
  protected readonly health = computed(() => (this.healthLoad.value() ?? []).find((h) => h.schemeId === this.scheme()?.id));

  /** The unit roll is the overview's main content; its state is the page's state. */
  protected readonly unitRows = loadable(() => this.unitData.list([this.scheme().id]).pipe(map((p) => p.items)));

  protected readonly units = computed(() => {
    const rows = this.unitRows.value() as UnitSummary[] | undefined;
    if (!rows) return null;
    return {
      total: rows.length,
      owner: rows.filter((r) => r.unit.occupancy === 'owner-occupied').length,
      tenanted: rows.filter((r) => r.unit.occupancy === 'tenanted').length,
      vacant: rows.filter((r) => r.unit.occupancy === 'vacant').length,
      arrears: rows.filter((r) => ['arrears', 'arrangement', 'handed-over'].includes(r.account.status)).length,
    };
  });

  protected readonly groups = computed(() => {
    const items = this.attention.openForScheme(this.scheme()?.id ?? '');
    const order: Urgency[] = ['overdue', 'today', 'week', 'later'];
    return order
      .map((u) => ({
        urgency: u,
        label: URGENCY_LABEL[u],
        tone: URGENCY_TONE[u],
        items: items.filter((w) => urgencyOf(w) === u).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      }))
      .filter((g) => g.items.length > 0);
  });

  protected readonly openCount = computed(() => this.groups().reduce((n, g) => n + g.items.length, 0));

  protected readonly compliance = COMPLIANCE;
  protected readonly collectionTone = collectionTone;
  protected readonly areaIcon = AREA_ICON;
  protected readonly urgencyOrder = URGENCY_ORDER;
  protected readonly formatDate = formatDate;

  protected view(w: WorkItem) {
    return workItemView(w);
  }

  protected open(w: WorkItem): void {
    this.drawer.open(WorkItemPreview, { id: w.id }, w.title);
  }
}
