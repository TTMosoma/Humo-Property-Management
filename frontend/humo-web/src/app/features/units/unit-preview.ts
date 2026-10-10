import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, of, switchMap } from 'rxjs';
import { AccountDataSource, UnitDataSource } from '../../domain';
import { AgeingBar } from '../../ui/ageing/ageing-bar';
import { Drawer } from '../../ui/drawer/drawer';
import { RandPipe, formatDate } from '../../ui/format/money';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { OCCUPANCY_LABEL, accountStatus, links } from '../accounts/account-view';
import { LogNote } from '../shared/log-note';

/** Quick look at a unit: who to talk to, what they owe, and a place to log the call. */
@Component({
  selector: 'app-unit-preview',
  imports: [Drawer, StatusPill, AgeingBar, LogNote, RouterLink, RandPipe, Skeleton, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (summary() === undefined) {
      <ui-drawer title="Loading unit…"><ui-skeleton [count]="5" /></ui-drawer>
    } @else if (summary() === null) {
      <ui-drawer title="Unit unavailable"><ui-error-state variant="inline" title="We couldn’t load this unit" message="Close and try again." (retry)="ref.close()" /></ui-drawer>
    } @else {
      @let s = summary()!;
      <ui-drawer [eyebrow]="s.scheme.name + ' · ' + s.unit.accountNo" [title]="'Unit ' + s.unit.number" [openLink]="unitLink()">
        <div drawerMeta class="meta">
          <ui-status-pill [label]="status().label" [tone]="status().tone" />
          <span>{{ s.unit.description }} · {{ s.unit.sizeM2 }} m² · {{ occupancy[s.unit.occupancy] }}</span>
        </div>

        <section class="balance">
          <div>
            <div class="label">Balance</div>
            <div class="amount money" [class.arrears]="s.account.balance > 0" [class.credit]="s.account.balance < 0">{{ s.account.balance | rand }}</div>
            <div class="sub">
              Levy {{ s.unit.monthlyLevy | rand }} pm
              @if (detail()?.lastPayment; as p) {
                · Last payment {{ -p.amount | rand }} on {{ formatDate(p.date) }}
              }
            </div>
          </div>
          <a class="btn btn-secondary btn-sm" [routerLink]="accountLink()" (click)="ref.close()">Account & statements</a>
        </section>
        @if (s.account.balance > 0) {
          <ui-ageing-bar [ageing]="s.account.ageing" />
        }

        <section>
          <h3 class="section-title">People</h3>
          @for (o of s.owners; track o.id) {
            <a class="person" [routerLink]="personLink(o.id)" (click)="ref.close()">
              <span class="avatar">{{ o.initials }}</span>
              <span class="p-text">
                <span class="p-name">{{ o.displayName }} <span class="role">Owner</span></span>
                <span class="p-contact">{{ o.phone }} · {{ o.email }}</span>
              </span>
              <span class="channel" [title]="'Prefers ' + o.preferredChannel">{{ o.preferredChannel === 'whatsapp' ? 'WhatsApp' : o.preferredChannel === 'sms' ? 'SMS' : 'Email' }}</span>
            </a>
          }
          @if (s.tenant; as t) {
            <a class="person" [routerLink]="personLink(t.id)" (click)="ref.close()">
              <span class="avatar tenant">{{ t.initials }}</span>
              <span class="p-text">
                <span class="p-name">{{ t.displayName }} <span class="role">Tenant</span></span>
                <span class="p-contact">{{ t.phone }} · {{ t.email }}</span>
              </span>
            </a>
          }
        </section>

        <section>
          <h3 class="section-title">Log a call</h3>
          <app-log-note [unitId]="s.unit.id" [personId]="s.owners[0]?.id" />
        </section>
      </ui-drawer>
    }
  `,
  styles: `
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); margin-top: var(--s-2); font-size: var(--fs-sm); color: var(--c-text-muted); }
    section { margin-top: var(--s-5); padding-top: var(--s-5); border-top: 1px solid var(--c-border); }
    section.balance { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s-4); margin: 0 0 var(--s-4); padding: 0; border: 0; }
    .label { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .amount { font-family: var(--font-display); font-size: var(--fs-3xl); font-weight: var(--fw-medium); line-height: 1.1; }
    .amount.arrears { color: var(--c-warning); }
    .sub { margin-top: 2px; font-size: var(--fs-xs); color: var(--c-text-muted); }
    .section-title { margin-bottom: var(--s-3); font-size: var(--fs-md); }
    .person {
      display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2); margin: 0 calc(-1 * var(--s-2)) var(--s-1);
      color: var(--c-text); border-radius: var(--r);
    }
    .person:hover { background: var(--c-surface-hover); text-decoration: none; }
    .avatar { display: grid; flex: none; place-items: center; width: 36px; height: 36px; font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--c-primary-text); background: var(--c-primary-soft); border-radius: 50%; }
    .avatar.tenant { color: var(--c-accent-strong); background: var(--c-accent-soft); }
    .p-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
    .p-name { font-weight: var(--fw-medium); }
    .role { margin-left: 4px; font-size: var(--fs-2xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-muted); }
    .p-contact { overflow: hidden; font-size: var(--fs-xs); color: var(--c-text-muted); white-space: nowrap; text-overflow: ellipsis; }
    .channel { flex: none; padding: 2px 8px; font-size: var(--fs-2xs); color: var(--c-text-2); background: var(--c-surface-sunken); border-radius: var(--r-pill); }
  `,
})
export class UnitPreview {
  private readonly data = inject<{ schemeId: string; number: string }>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  private readonly units = inject(UnitDataSource);
  private readonly accounts = inject(AccountDataSource);

  /** undefined = loading, null = failed. */
  protected readonly summary = toSignal(this.units.get(this.data.schemeId, this.data.number).pipe(catchError(() => of(null))));
  /** The account detail (for "last payment") follows once the unit is known. */
  protected readonly detail = toSignal(
    toObservable(this.summary).pipe(
      switchMap((s) => (s ? this.accounts.get(s.account.id).pipe(catchError(() => of(undefined))) : of(undefined))),
    ),
  );

  protected readonly status = computed(() => accountStatus(this.summary()!.account));
  protected readonly unitLink = computed(() => links.unit({ id: this.data.schemeId }, { number: this.data.number }));
  protected readonly accountLink = computed(() => links.account({ id: this.data.schemeId }, { number: this.data.number }));
  protected readonly occupancy = OCCUPANCY_LABEL;
  protected readonly formatDate = formatDate;

  protected personLink(id: string): string {
    return links.person({ id });
  }
}
