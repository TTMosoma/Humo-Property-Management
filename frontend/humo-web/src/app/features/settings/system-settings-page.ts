import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OpsDataSource, SystemConfig } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { REASON_FIELD, openForm } from '../shared/form-drawer';

const WHEN = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** ISO → the value a datetime-local input wants (local time, no seconds). */
function toLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Settings › System (Humo System Administrators): platform-wide policy and the
 * maintenance banner every signed-in user sees. Feature flags have their own page.
 */
@Component({
  selector: 'app-system-settings-page',
  imports: [PageHeader, ErrorState, Skeleton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Settings" title="System" subtitle="Platform-wide policy and scheduled maintenance. Feature rollout is in Feature flags; health in Platform health." />

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="2" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the system configuration" (retry)="result.retry()" /></div>
    } @else {
      @let c = result.value()!;
      <section class="surface panel">
        <div class="panel-head">
          <h2 class="section-title">Scheduled maintenance</h2>
          @if (canManage()) {
            <div class="acts">
              @if (c.maintenance) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="clearMaintenance(c)">Remove</button>
              }
              <button type="button" class="btn btn-secondary btn-sm" (click)="editMaintenance(c)">{{ c.maintenance ? 'Change' : 'Schedule' }}</button>
            </div>
          }
        </div>
        @if (c.maintenance; as m) {
          <p><strong>{{ when(m.startsAt) }} – {{ when(m.endsAt) }}</strong></p>
          <p>{{ m.message }}</p>
          <p class="muted">Every signed-in user sees this as a banner until it ends.</p>
        } @else {
          <p class="muted">Nothing scheduled. When you schedule maintenance, every signed-in user sees a banner until it ends.</p>
        }
      </section>

      <section class="surface panel">
        <div class="panel-head">
          <h2 class="section-title">Policy</h2>
          @if (canManage()) {
            <button type="button" class="btn btn-secondary btn-sm" (click)="editPolicy(c)">Change</button>
          }
        </div>
        <dl class="facts">
          <dt>Largest upload</dt><dd>{{ c.uploadLimitMb }} MB per document</dd>
          <dt>Session timeout</dt><dd>{{ c.sessionIdleMinutes }} minutes without activity</dd>
          <dt>Staff sign-in</dt><dd>{{ c.requirePasskeysForStaff ? 'Passkeys only (no passwords)' : 'Passkeys or passwords' }}</dd>
          <dt>Audit records kept</dt><dd>{{ c.auditRetentionYears }} years</dd>
        </dl>
        <p class="muted">The API enforces these for every customer. Document uploads already follow the size limit. Changes are in the <a routerLink="/platform/audit">platform audit log</a>.</p>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); max-width: 900px; }
    .panel { padding: var(--s-4) var(--s-5); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; }
    .acts { display: flex; gap: var(--s-2); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    p { margin: 0 0 var(--s-2); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .facts { display: grid; grid-template-columns: 200px 1fr; gap: var(--s-2) var(--s-4); margin: var(--s-2) 0 var(--s-3); font-size: var(--fs-sm); }
    .facts dt { color: var(--c-text-muted); }
    .facts dd { margin: 0; }
  `,
})
export class SystemSettingsPage {
  private readonly data = inject(OpsDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);

  protected readonly result = loadable(() => this.data.config());
  protected readonly canManage = computed(() => this.session.can('Platform.Config.Manage') && !this.session.readOnly());
  protected readonly when = (iso: string) => WHEN.format(new Date(iso));

  private save(c: SystemConfig, change: Partial<Omit<SystemConfig, 'version'>>, reason: string) {
    const { version, ...rest } = c;
    return this.data.updateConfig({ ...rest, ...change }, reason, version);
  }

  protected editMaintenance(c: SystemConfig): void {
    const start = c.maintenance?.startsAt ?? new Date(Date.now() + 2 * 86_400_000).toISOString();
    const end = c.maintenance?.endsAt ?? new Date(new Date(start).getTime() + 3_600_000).toISOString();
    openForm(this.drawer, {
      eyebrow: 'System',
      title: 'Scheduled maintenance',
      intro: 'Every signed-in user sees a banner from now until the window ends. Choose a quiet time: weekends early in the morning.',
      fields: [
        { key: 'startsAt', label: 'Starts', type: 'datetime-local', required: true, half: true },
        { key: 'endsAt', label: 'Ends', type: 'datetime-local', required: true, half: true },
        { key: 'message', label: 'What people should know', type: 'textarea', required: true, placeholder: 'e.g. Humo will be unavailable for up to an hour while we upgrade the database.' },
        REASON_FIELD,
      ],
      initial: { startsAt: toLocal(start), endsAt: toLocal(end), message: c.maintenance?.message ?? '' },
      submitLabel: 'Save',
      stepUp: { action: 'change-platform-config', detail: 'Schedule maintenance shown to every Humo user' },
      submit: (v) => this.save(c, { maintenance: { startsAt: new Date(v['startsAt']).toISOString(), endsAt: new Date(v['endsAt']).toISOString(), message: v['message'].trim() } }, v['reason']),
      success: () => 'Maintenance scheduled. Everyone signed in now sees the banner.',
      failure: 'The maintenance window wasn’t saved',
    });
  }

  protected clearMaintenance(c: SystemConfig): void {
    openForm(this.drawer, {
      eyebrow: 'System',
      title: 'Remove scheduled maintenance',
      intro: 'The banner disappears for everyone.',
      fields: [REASON_FIELD],
      submitLabel: 'Remove',
      stepUp: { action: 'change-platform-config', detail: 'Remove the scheduled maintenance banner' },
      submit: (v) => this.save(c, { maintenance: null }, v['reason']),
      success: () => 'Maintenance removed.',
      failure: 'It wasn’t removed',
    });
  }

  protected editPolicy(c: SystemConfig): void {
    openForm(this.drawer, {
      eyebrow: 'System',
      title: 'Policy',
      intro: 'These apply to every customer as soon as you save.',
      fields: [
        { key: 'uploadLimitMb', label: 'Largest upload (MB)', type: 'number', required: true, half: true },
        { key: 'sessionIdleMinutes', label: 'Session timeout (minutes)', type: 'number', required: true, half: true },
        { key: 'requirePasskeysForStaff', label: 'Staff sign-in', type: 'select', required: true, half: true, options: [{ value: 'yes', label: 'Passkeys only' }, { value: 'no', label: 'Passkeys or passwords' }] },
        { key: 'auditRetentionYears', label: 'Keep audit records (years)', type: 'number', required: true, half: true },
        REASON_FIELD,
      ],
      initial: { uploadLimitMb: String(c.uploadLimitMb), sessionIdleMinutes: String(c.sessionIdleMinutes), requirePasskeysForStaff: c.requirePasskeysForStaff ? 'yes' : 'no', auditRetentionYears: String(c.auditRetentionYears) },
      submitLabel: 'Save policy',
      stepUp: { action: 'change-platform-config', detail: 'Change platform-wide policy' },
      submit: (v) =>
        this.save(c, { uploadLimitMb: Number(v['uploadLimitMb']), sessionIdleMinutes: Number(v['sessionIdleMinutes']), requirePasskeysForStaff: v['requirePasskeysForStaff'] === 'yes', auditRetentionYears: Number(v['auditRetentionYears']) }, v['reason']),
      success: () => 'Policy saved.',
      failure: 'The policy wasn’t saved',
    });
  }
}
