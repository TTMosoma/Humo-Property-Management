import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, of } from 'rxjs';
import { MaintenanceWindow, OpsDataSource } from '../../domain';

const WHEN = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** Humo's scheduled maintenance, shown to everyone signed in until the window ends (Settings › System). */
@Component({
  selector: 'app-maintenance-banner',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (window(); as w) {
      <div class="banner no-print" role="status">
        <ion-icon name="construct-outline" aria-hidden="true" />
        <span><strong>{{ live() ? 'Maintenance in progress' : 'Scheduled maintenance' }}</strong> · {{ when(w) }} · {{ w.message }}</span>
      </div>
    }
  `,
  styles: `
    .banner { display: flex; gap: var(--s-2); align-items: center; justify-content: center; padding: 6px var(--s-4); font-size: var(--fs-sm); color: var(--c-text); background: var(--c-warning-soft); border-bottom: 1px solid var(--c-border); text-align: center; }
    ion-icon { flex: none; color: var(--c-warning); }
  `,
})
export class MaintenanceBanner {
  protected readonly window = toSignal(inject(OpsDataSource).maintenance().pipe(catchError(() => of(null))), { initialValue: null as MaintenanceWindow | null });
  protected readonly live = computed(() => {
    const w = this.window();
    return !!w && new Date(w.startsAt).getTime() <= Date.now();
  });
  protected when(w: MaintenanceWindow): string {
    return `${WHEN.format(new Date(w.startsAt))} – ${WHEN.format(new Date(w.endsAt)).split(', ').at(-1)}`;
  }
}
