import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { PersonSummary } from '../../domain';
import { RandPipe, formatDate } from '../../ui/format/money';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { accountStatus, links } from '../accounts/account-view';

/**
 * A person's relationship header: every role they hold, each linking along the
 * chain (scheme → unit → account), with the account balance where they own.
 * Used on the person page and in the person preview.
 */
@Component({
  selector: 'app-person-relationships',
  imports: [RouterLink, IonIcon, StatusPill, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul>
      @for (r of person().relationships; track r.relationship.id) {
        <li [class]="r.relationship.type">
          <span class="type">{{ r.relationship.type === 'trustee' ? r.relationship.portfolio : r.relationship.type === 'owner' ? 'Owner' : 'Tenant' }}</span>
          <div class="where">
            <a [routerLink]="links.scheme(r.scheme)" (click)="navigated.emit()">{{ r.scheme.name }}</a>
            @if (r.unit; as u) {
              <ion-icon name="chevron-forward-outline" aria-hidden="true" />
              <a [routerLink]="links.unit(r.scheme, u)" (click)="navigated.emit()">Unit {{ u.number }}</a>
            }
            @if (r.account; as a) {
              <ion-icon name="chevron-forward-outline" aria-hidden="true" />
              <a [routerLink]="links.account(r.scheme, r.unit!)" (click)="navigated.emit()">{{ a.accountNo }}</a>
            }
            <div class="since">
              Since {{ formatDate(r.relationship.since) }}
              @if (r.relationship.until) { · lease ends {{ formatDate(r.relationship.until) }} }
            </div>
          </div>
          @if (r.account; as a) {
            <div class="bal">
              <span class="money" [class.arrears]="a.balance > 0" [class.credit]="a.balance < 0">{{ a.balance | rand }}</span>
              <ui-status-pill [label]="status(a).label" [tone]="status(a).tone" />
            </div>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    ul { margin: 0; padding: 0; list-style: none; }
    li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); }
    li:last-child { border-bottom: 0; }
    .type {
      flex: none; width: 96px; padding: 3px 0; font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-align: center;
      border-radius: var(--r-pill); color: var(--c-primary-text); background: var(--c-primary-soft);
    }
    .tenant .type { color: var(--c-accent-strong); background: var(--c-accent-soft); }
    .trustee .type { color: var(--c-warning); background: var(--c-warning-soft); }
    .where { flex: 1; min-width: 0; font-size: var(--fs-sm); }
    .where a { font-weight: var(--fw-medium); }
    .where ion-icon { margin: 0 2px; font-size: 11px; color: var(--c-text-faint); vertical-align: middle; }
    .since { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .bal { display: flex; flex: none; flex-direction: column; align-items: flex-end; gap: 4px; }
    .bal .money { font-weight: var(--fw-semibold); }
    .money.arrears { color: var(--c-warning); }
  `,
})
export class PersonRelationships {
  readonly person = input.required<PersonSummary>();
  readonly navigated = output<void>();
  protected readonly links = links;
  protected readonly formatDate = formatDate;
  protected readonly status = accountStatus;
}
