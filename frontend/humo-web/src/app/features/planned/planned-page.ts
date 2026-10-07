import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { ROLE_LABELS, Role, Scheme } from '../../domain';
import { pageState } from '../../core/prototype/page-state';
import { Illustration } from '../../ui/illustration/illustration';
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

/** Build order from docs/02-ux-review.md §4.2 (vertical workflow slices). */
const CHECKPOINTS: Record<number, string> = {
  2: 'Foundations',
  3: 'Slice A · Owner calls about their balance',
  4: 'Slice B · Fix the leaking geyser',
  5: 'Slice C · Run the trustee meeting',
  6: 'Credit control & billing run',
  7: 'Dashboard, Compliance & Documents',
  8: 'Roles, resident portal & mobile',
};

/**
 * Placeholder for screens not built yet. It states the job the screen serves and
 * what it will contain, so the navigation can be reviewed end to end now.
 * Inside a record workspace (e.g. a scheme's tabs) it renders compactly under
 * the record header instead of repeating a page header.
 */
@Component({
  selector: 'app-planned-page',
  imports: [IonIcon, PageHeader, EmptyState, ErrorState, Skeleton, Illustration],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned-page.html',
  styleUrl: './planned-page.scss',
})
export class PlannedPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly page = pageState();

  private readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
  private readonly title$ = toSignal(this.route.title, { initialValue: this.route.snapshot.title });

  protected readonly title = computed(() => this.title$() ?? 'Untitled');
  protected readonly meta = computed(() => this.data()['planned'] as PlannedMeta | undefined);
  protected readonly section = computed(() => this.data()['section'] as string | undefined);
  protected readonly scheme = computed(() => this.data()['scheme'] as Scheme | undefined);
  /** Inside a scheme workspace the record header is already on screen. */
  protected readonly embedded = computed(() => !!this.scheme());
  protected readonly roles = computed(() =>
    ((this.data()['roles'] as Role[] | undefined) ?? []).map((r) => ROLE_LABELS[r]),
  );
  protected readonly checkpointName = computed(() => CHECKPOINTS[this.meta()?.checkpoint ?? 0] ?? '');
}
