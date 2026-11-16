import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AgencyInvitation, AgencyInvitationsDataSource } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { openForm } from '../shared/form-drawer';

/**
 * D46: another agency has invited someone who already signs in to Humo. They check what that agency recorded about them,
 * put it right if it's wrong, and accept; or decline. Nothing changes until they do, and neither agency sees the other's
 * record of them.
 */
@Component({
  selector: 'app-invitations-page',
  imports: [PageHeader, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Invitations" subtitle="Agencies that would like you to use Humo Property Management with them too." />
    @if (result.loading()) {
      <ui-skeleton [count]="2" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load your invitations" (retry)="result.retry()" /></div>
    } @else {
      @for (i of result.value() ?? []; track i.organisationId) {
        <article class="surface invitation">
          <h2>{{ i.organisation }}</h2>
          <p class="meta">Invited you on {{ formatDate(i.invitedAt) }}</p>
          <p>Accepting adds {{ i.organisation }} to your roles: you’ll switch between your agencies with the same sign-in and passkey. Each agency keeps its own record of you and sees only its own.</p>
          @if (i.roles.length) {
            <h3>Your roles there</h3>
            <ul>
              @for (r of i.roles; track r) { <li>{{ r }}</li> }
            </ul>
          }
          <h3>What {{ i.organisation }} has for you</h3>
          <dl class="facts">
            <dt>Name</dt><dd>{{ i.name }}</dd>
            <dt>Email</dt><dd>{{ i.email }}</dd>
            <dt>Mobile</dt><dd>{{ i.phone || 'None' }}</dd>
          </dl>
          <p class="muted">Something wrong? Put it right as you accept: {{ i.organisation }} is told what you changed.</p>
          <div class="actions">
            <button type="button" class="btn btn-primary" [disabled]="session.readOnly()" (click)="accept(i)">Check and accept</button>
            <button type="button" class="btn btn-ghost" [disabled]="session.readOnly()" (click)="decline(i)">Decline</button>
          </div>
        </article>
      } @empty {
        <div class="surface"><ui-empty-state illustration="empty-tray" title="No invitations waiting" message="When another agency invites you, it appears here and in your notifications." /></div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-3); max-width: 760px; }
    .invitation { padding: var(--s-4) var(--s-5); }
    h2 { margin: 0; font-size: var(--fs-lg); }
    h3 { margin: var(--s-4) 0 var(--s-2); font-size: var(--fs-sm); }
    .meta { margin: 2px 0 0; font-size: var(--fs-xs); color: var(--c-text-muted); }
    p { margin: var(--s-3) 0 0; line-height: 1.55; }
    ul { margin: 0; padding-left: var(--s-4); font-size: var(--fs-sm); }
    .facts { display: grid; grid-template-columns: 100px 1fr; gap: var(--s-2) var(--s-4); margin: 0; font-size: var(--fs-sm); }
    .facts dt { color: var(--c-text-muted); }
    .facts dd { margin: 0; }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .actions { display: flex; gap: var(--s-2); margin-top: var(--s-4); }
  `,
})
export class InvitationsPage {
  private readonly data = inject(AgencyInvitationsDataSource);
  private readonly drawer = inject(DrawerService);
  protected readonly session = inject(SessionService);
  protected readonly result = loadable(() => this.data.mine());
  protected readonly formatDate = formatDate;

  protected accept(i: AgencyInvitation): void {
    openForm(this.drawer, {
      eyebrow: `Invitation · ${i.organisation}`,
      title: `Join ${i.organisation}`,
      intro: `Check what ${i.organisation} has for you and correct it if it’s wrong. Your email stays ${i.email}: it’s your sign-in.`,
      fields: [
        { key: 'name', label: 'Your name', type: 'text', required: true },
        { key: 'phone', label: 'Mobile number', type: 'tel', placeholder: '082 123 4567', help: 'Optional. For this agency only.' },
      ],
      initial: { name: i.name, phone: i.phone },
      submitLabel: 'Accept',
      submit: (f) =>
        this.data.accept(i.organisationId, {
          name: (f['name'] ?? '').trim() !== i.name ? f['name'] : undefined,
          phone: (f['phone'] ?? '').trim() && (f['phone'] ?? '').trim() !== i.phone ? f['phone'] : undefined,
        }),
      success: () => `You’ve joined ${i.organisation}. Switch to it from your roles.`,
      failure: 'The invitation wasn’t accepted',
    });
  }

  protected decline(i: AgencyInvitation): void {
    openForm(this.drawer, {
      eyebrow: `Invitation · ${i.organisation}`,
      title: `Decline ${i.organisation}’s invitation`,
      intro: `${i.organisation} is told you declined. Your other agencies aren’t affected, and nothing about them is shared.`,
      fields: [],
      submitLabel: 'Decline',
      submit: () => this.data.decline(i.organisationId),
      success: () => `You declined ${i.organisation}’s invitation.`,
      failure: 'The invitation wasn’t declined',
    });
  }
}
