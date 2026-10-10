import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { PERMISSION_META, Permission, ROLE_LABELS, ROLE_PERMISSIONS, Role, Scheme } from '../../domain';
import { PrototypeStateService } from '../../core/prototype/prototype-state.service';
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
  /** A placeholder for a screen not built yet: it previews the simulated state, there's no request. */
  protected readonly view = inject(PrototypeStateService).viewState;

  private readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
  private readonly title$ = toSignal(this.route.title, { initialValue: this.route.snapshot.title });

  protected readonly title = computed(() => this.title$() ?? 'Untitled');
  protected readonly meta = computed(() => this.data()['planned'] as PlannedMeta | undefined);
  protected readonly section = computed(() => this.data()['section'] as string | undefined);
  protected readonly scheme = computed(() => this.data()['scheme'] as Scheme | undefined);
  /** Inside a scheme workspace the record header is already on screen. */
  protected readonly embedded = computed(() => !!this.scheme());
  /** The route's permission, and the roles that carry it (the same check the route guard makes). */
  protected readonly permission = computed(() => {
    const p = this.data()['permission'] as Permission | undefined;
    return p ? PERMISSION_META[p]?.label : undefined;
  });
  protected readonly roles = computed(() => {
    const p = this.data()['permission'] as Permission | undefined;
    if (!p) return [];
    return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes(p)).map((r) => ROLE_LABELS[r]);
  });
}
