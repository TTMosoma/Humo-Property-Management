import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CHANNEL_LABELS, Channel, PersonalPreferences, ROLE_LABELS, SettingsDataSource, activeAssignments, describeFailure, fieldErrorsOf } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

const WORK_CHANNELS: Channel[] = ['email', 'push', 'sms'];

/** Settings › My profile: who you are in Humo, your roles, and how you want to hear about your work. */
@Component({
  selector: 'app-profile-page',
  imports: [PageHeader, ErrorState, Skeleton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Settings" title="My profile" subtitle="Your details, your roles, and how Humo tells you about your work." />

    <section class="surface panel">
      <h2 class="section-title">You</h2>
      <dl class="facts">
        <dt>Name</dt><dd>{{ me().name }}</dd>
        <dt>Email</dt><dd>{{ me().email }}</dd>
        @if (me().title) { <dt>Title</dt><dd>{{ me().title }}</dd> }
        <dt>Roles</dt>
        <dd>
          <ul class="roles">
            @for (r of roles(); track r.id) {
              <li>{{ r.label }}<span class="muted"> · {{ r.scope }}</span></li>
            }
          </ul>
        </dd>
      </dl>
      <p class="muted">Your name, email and roles are managed by your agency administrator in Users & access. Passkeys and devices: <a routerLink="/settings/security">Security</a>.</p>
    </section>

    @if (prefs.loading()) {
      <ui-skeleton [count]="4" />
    } @else if (prefs.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load your preferences" (retry)="prefs.retry()" /></div>
    } @else {
      <section class="surface panel">
        <h2 class="section-title">Notifications</h2>
        <form class="form" (submit)="$event.preventDefault(); save()">
          <fieldset>
            <legend>Tasks assigned to me and approvals waiting</legend>
            <div class="chans">
              @for (c of channels; track c) {
                <label><input type="checkbox" [checked]="draft().work.includes(c)" (change)="setChannel(c, $any($event.target).checked)" /> {{ label(c) }}</label>
              }
            </div>
            @if (errors()['work']; as m) { <div class="err">{{ m }}</div> }
          </fieldset>
          <label class="field">
            <span>Summary email</span>
            <select (change)="set('digest', $any($event.target).value)">
              <option value="daily" [selected]="draft().digest === 'daily'">Every morning</option>
              <option value="weekly" [selected]="draft().digest === 'weekly'">Monday mornings</option>
              <option value="none" [selected]="draft().digest === 'none'">Don’t send one</option>
            </select>
          </label>
          <div class="row">
            <label class="field">
              <span>Quiet from</span>
              <input type="time" [value]="draft().quietFrom ?? ''" (input)="set('quietFrom', $any($event.target).value)" />
              @if (errors()['quietFrom']; as m) { <span class="err">{{ m }}</span> }
            </label>
            <label class="field">
              <span>Until</span>
              <input type="time" [value]="draft().quietTo ?? ''" (input)="set('quietTo', $any($event.target).value)" />
              @if (errors()['quietTo']; as m) { <span class="err">{{ m }}</span> }
            </label>
          </div>
          <p class="muted">No SMS or Humo Mobile notifications during quiet hours; they wait until morning. Email isn’t affected.</p>
          <div>
            <button type="submit" class="btn btn-primary" [disabled]="!dirty() || busy() || session.readOnly()">{{ busy() ? 'Saving…' : 'Save preferences' }}</button>
          </div>
        </form>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); max-width: 820px; }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-3); font-size: var(--fs-md); }
    .facts { display: grid; grid-template-columns: 120px 1fr; gap: var(--s-2) var(--s-4); margin: 0 0 var(--s-3); font-size: var(--fs-sm); }
    .facts dt { color: var(--c-text-muted); }
    .facts dd { margin: 0; }
    .roles { margin: 0; padding: 0; list-style: none; }
    .muted { margin: 0; font-size: var(--fs-sm); color: var(--c-text-muted); }
    .form { display: flex; flex-direction: column; gap: var(--s-4); }
    fieldset { margin: 0; padding: 0; border: 0; }
    legend { margin-bottom: var(--s-2); font-size: var(--fs-sm); font-weight: var(--fw-medium); }
    .chans { display: flex; flex-wrap: wrap; gap: var(--s-4); font-size: var(--fs-sm); }
    .chans label { display: inline-flex; gap: 6px; align-items: center; }
    .field { display: flex; flex-direction: column; gap: 6px; max-width: 280px; font-size: var(--fs-sm); }
    .field > span:first-child { font-weight: var(--fw-medium); color: var(--c-text-2); }
    .row { display: flex; flex-wrap: wrap; gap: var(--s-4); }
    .err { font-size: var(--fs-xs); color: var(--c-danger); }
  `,
})
export class ProfilePage {
  private readonly data = inject(SettingsDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  protected readonly me = this.session.identity;
  protected readonly roles = computed(() =>
    activeAssignments(this.me()).map((a) => ({
      id: a.id,
      label: ROLE_LABELS[a.role],
      scope: a.scope.type === 'organisation' ? 'all schemes' : a.scope.unitId ? 'own unit' : `${a.scope.schemeIds.length} scheme${a.scope.schemeIds.length === 1 ? '' : 's'}`,
    })),
  );

  protected readonly prefs = loadable(() => this.data.preferences());
  protected readonly draft = signal<Omit<PersonalPreferences, 'identityId'>>({ version: 0, work: [], digest: 'daily' });
  protected readonly busy = signal(false);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly channels = WORK_CHANNELS;
  protected readonly label = (c: Channel) => CHANNEL_LABELS[c];
  protected readonly dirty = computed(() => {
    const p = this.prefs.value();
    const d = this.draft();
    return !!p && (p.digest !== d.digest || (p.quietFrom ?? '') !== (d.quietFrom ?? '') || (p.quietTo ?? '') !== (d.quietTo ?? '') || [...p.work].sort().join() !== [...d.work].sort().join());
  });

  constructor() {
    effect(() => {
      const p = this.prefs.value();
      if (p) this.draft.set({ version: p.version, work: [...p.work], digest: p.digest, quietFrom: p.quietFrom, quietTo: p.quietTo });
    });
  }

  protected setChannel(c: Channel, on: boolean): void {
    this.draft.update((d) => ({ ...d, work: on ? [...d.work, c] : d.work.filter((x) => x !== c) }));
  }

  protected set(key: 'digest' | 'quietFrom' | 'quietTo', value: string): void {
    this.draft.update((d) => ({ ...d, [key]: value || undefined }));
  }

  protected save(): void {
    const { version, ...prefs } = this.draft();
    this.busy.set(true);
    this.data.updatePreferences({ ...prefs, digest: prefs.digest ?? 'daily' }, version).subscribe({
      next: () => {
        this.busy.set(false);
        this.errors.set({});
        this.feedback.success('Preferences saved.');
      },
      error: (e) => {
        this.busy.set(false);
        this.errors.set(fieldErrorsOf(e));
        this.feedback.error(describeFailure(e, 'Your preferences weren’t saved'));
      },
    });
  }
}
