import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CHANNEL_LABELS, Channel, NOTIFICATION_EVENTS, NotificationRule, SettingsDataSource, describeFailure, fieldErrorsOf } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

const AUDIENCES = [
  { id: 'residents', label: 'Owners and tenants' },
  { id: 'trustees', label: 'Trustees' },
  { id: 'staff', label: 'Your team' },
] as const;

/**
 * Settings › Notifications: which events tell whom, and how. Residents only
 * open the portal when it tells them something (review finding F24), so these
 * rules decide what owners and tenants hear about.
 */
@Component({
  selector: 'app-notification-settings-page',
  imports: [PageHeader, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Settings" title="Notifications" subtitle="What owners, tenants, trustees and your team are told when something happens, and by which channels. Each person can quieten their own in My profile." />

    @if (agency.loading()) {
      <ui-skeleton [count]="8" />
    } @else if (agency.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the notification rules" (retry)="agency.retry()" /></div>
    } @else {
      @for (g of groups; track g.id) {
        <section class="surface panel">
          <h2 class="section-title">{{ g.label }}</h2>
          <table class="rules">
            <thead>
              <tr><th scope="col">When</th><th scope="col">On</th><th scope="col">Channels</th></tr>
            </thead>
            <tbody>
              @for (e of g.events; track e.id) {
                @let r = rule(e.id);
                <tr [class.off]="!r.enabled">
                  <th scope="row">
                    <div class="e-label">{{ e.label }}</div>
                    <div class="muted">{{ e.description }}</div>
                    @if (error()[e.id]; as msg) { <div class="err" role="alert">{{ msg }}</div> }
                  </th>
                  <td>
                    <label class="switch">
                      <input type="checkbox" [checked]="r.enabled" [disabled]="!canManage() || !!e.required" (change)="toggle(e.id, $any($event.target).checked)" />
                      <span>{{ e.required ? 'Always' : r.enabled ? 'On' : 'Off' }}</span>
                    </label>
                  </td>
                  <td>
                    <div class="channels">
                      @for (c of e.channels; track c) {
                        <label class="chan">
                          <input type="checkbox" [checked]="r.channels.includes(c)" [disabled]="!canManage() || !r.enabled" (change)="setChannel(e.id, c, $any($event.target).checked)" />
                          {{ channelLabel(c) }}
                        </label>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }
      @if (canManage()) {
        <div class="save">
          <button type="button" class="btn btn-primary" [disabled]="!dirty() || busy()" (click)="save()">{{ busy() ? 'Saving…' : 'Save rules' }}</button>
          @if (dirty()) {
            <button type="button" class="btn btn-ghost" (click)="reset()">Undo changes</button>
          }
        </div>
      }
      <p class="muted note">WhatsApp needs the WhatsApp add-on; messages are recorded in Communications › Sent once it exists.</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .rules { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .rules th, .rules td { padding: var(--s-2); border-top: 1px solid var(--c-border); text-align: left; vertical-align: top; }
    .rules thead th { font-size: var(--fs-xs); color: var(--c-text-muted); text-transform: uppercase; letter-spacing: 0.04em; border-top: 0; }
    .rules tbody th { font-weight: var(--fw-regular); width: 50%; }
    .e-label { font-weight: var(--fw-medium); }
    tr.off .e-label { color: var(--c-text-muted); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .err { margin-top: 4px; font-size: var(--fs-xs); color: var(--c-danger); }
    .switch, .chan { display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
    .channels { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); }
    .save { display: flex; gap: var(--s-2); }
    .note { margin: 0; }
    @media (max-width: 700px) { .rules thead { display: none; } .rules tr { display: block; padding: var(--s-2) 0; border-top: 1px solid var(--c-border); } .rules th, .rules td { display: block; border: 0; padding: 4px 0; width: auto !important; } }
  `,
})
export class NotificationSettingsPage {
  private readonly data = inject(SettingsDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly session = inject(SessionService);

  protected readonly agency = loadable(() => this.data.agency());
  protected readonly draft = signal<NotificationRule[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<Record<string, string>>({});

  protected readonly groups = AUDIENCES.map((a) => ({ ...a, events: NOTIFICATION_EVENTS.filter((e) => e.audience === a.id) }));
  protected readonly canManage = computed(() => this.session.can('Notifications.Configure') && !this.session.readOnly());
  protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.agency.value()?.notifications ?? []));
  protected readonly channelLabel = (c: Channel) => CHANNEL_LABELS[c];

  constructor() {
    // Start from the saved rules whenever they (re)load.
    effect(() => {
      const saved = this.agency.value()?.notifications;
      if (saved) this.draft.set(saved.map((r) => ({ ...r, channels: [...r.channels] })));
    });
  }

  protected rule(event: NotificationRule['event']): NotificationRule {
    return this.draft().find((r) => r.event === event) ?? { event, enabled: false, channels: [] };
  }

  protected toggle(event: NotificationRule['event'], enabled: boolean): void {
    this.patch(event, (r) => ({ ...r, enabled }));
  }

  protected setChannel(event: NotificationRule['event'], c: Channel, on: boolean): void {
    this.patch(event, (r) => ({ ...r, channels: on ? [...r.channels, c] : r.channels.filter((x) => x !== c) }));
  }

  private patch(event: NotificationRule['event'], change: (r: NotificationRule) => NotificationRule): void {
    const exists = this.draft().some((r) => r.event === event);
    this.draft.update((rules) => (exists ? rules.map((r) => (r.event === event ? change(r) : r)) : [...rules, change(this.rule(event))]));
    this.error.set({});
  }

  protected reset(): void {
    this.draft.set((this.agency.value()?.notifications ?? []).map((r) => ({ ...r, channels: [...r.channels] })));
    this.error.set({});
  }

  protected save(): void {
    this.busy.set(true);
    this.data.updateNotifications(this.draft(), this.agency.value()?.version).subscribe({
      next: () => {
        this.busy.set(false);
        this.feedback.success('Notification rules saved.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(fieldErrorsOf(e));
        this.feedback.error(describeFailure(e, 'The rules weren’t saved'));
      },
    });
  }
}
