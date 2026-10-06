import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Subscription } from 'rxjs';
import { ROLE_LABELS, Role, Scheme } from '../../domain';
import { PrototypeStateService } from '../../core/prototype/prototype-state.service';
import { mockResponder } from '../../mock/mock-latency';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

export interface PlannedMeta {
  /** The job the user is trying to get done on this screen. */
  job: string;
  /** What the finished screen will contain. */
  planned: string[];
  checkpoint: number;
}

const CHECKPOINTS: Record<number, string> = {
  2: 'Dashboard & Tasks',
  3: 'Portfolio, Schemes, Units & People',
  4: 'Finance',
  5: 'Maintenance & Suppliers',
  6: 'Communications & Documents',
  7: 'Governance & Compliance',
  8: 'Reports, Settings, Resident portal & Platform',
};

/**
 * Placeholder for screens not built yet. It states the job the screen serves and
 * what it will contain, so the navigation can be reviewed end to end now.
 * It also exercises the shared loading / empty / error states.
 */
@Component({
  selector: 'app-planned-page',
  imports: [IonIcon, PageHeader, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned-page.html',
  styleUrl: './planned-page.scss',
})
export class PlannedPage {
  private readonly route = inject(ActivatedRoute);
  private readonly proto = inject(PrototypeStateService);
  private readonly respond = mockResponder();

  private readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
  private readonly title$ = toSignal(this.route.title, { initialValue: this.route.snapshot.title });

  protected readonly title = computed(() => this.title$() ?? 'Untitled');
  protected readonly meta = computed(() => this.data()['planned'] as PlannedMeta | undefined);
  protected readonly section = computed(() => this.data()['section'] as string | undefined);
  protected readonly scheme = computed(() => this.data()['scheme'] as Scheme | undefined);
  protected readonly roles = computed(() =>
    ((this.data()['roles'] as Role[] | undefined) ?? []).map((r) => ROLE_LABELS[r]),
  );
  protected readonly checkpointName = computed(() => CHECKPOINTS[this.meta()?.checkpoint ?? 0] ?? '');

  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly viewState = this.proto.viewState;

  private sub?: Subscription;

  constructor() {
    // Reload whenever the page or the simulated state changes.
    effect(() => {
      this.data();
      this.proto.viewState();
      this.load();
    });
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
  }

  protected load(): void {
    this.sub?.unsubscribe();
    this.status.set('loading');
    if (this.proto.viewState() === 'loading') return;
    this.sub = this.respond(true).subscribe({
      next: () => this.status.set('ready'),
      error: () => this.status.set('error'),
    });
  }
}
