import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { IonIcon } from '@ionic/angular/standalone';
import { AttentionService } from '../../core/attention/attention.service';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { STAFF, personName } from '../../mock/fixtures/staff';
import { Drawer } from '../../ui/drawer/drawer';
import { RandPipe, formatDate } from '../../ui/format/money';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { ApprovalCard } from './approval-card';
import { workItemView } from './work-item-view';

/** Preview of any work item, opened from Tasks, Approvals, the bell or a scheme overview. */
@Component({
  selector: 'app-work-item-preview',
  imports: [Drawer, StatusPill, ApprovalCard, IonIcon, RouterLink, RandPipe, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (item(); as w) {
      @let v = view()!;
      <ui-drawer [eyebrow]="v.typeLabel + ' · ' + w.ref" [title]="w.title" [openLink]="w.route">
        <div drawerMeta class="meta">
          <ui-status-pill [label]="v.due" [tone]="v.tone" />
          @if (scheme(); as s) {
            <a [routerLink]="['/schemes', s.id, 'overview']" (click)="ref.close()">{{ s.name }}</a>
          }
        </div>

        @if (w.kind === 'approval') {
          <app-approval-card [item]="w" [compact]="true" />
        } @else {
          <p class="detail">{{ w.detail }}</p>
        }

        <dl class="facts">
          <dt>Area</dt><dd>{{ v.area }}</dd>
          @if (w.unitLabel) { <dt>Unit</dt><dd>{{ w.unitLabel }}</dd> }
          @if (w.personName) { <dt>Person</dt><dd>{{ w.personName }}</dd> }
          @if (w.supplierName) { <dt>Supplier</dt><dd>{{ w.supplierName }}</dd> }
          @if (w.amount && w.kind !== 'approval') { <dt>Amount</dt><dd class="money">{{ w.amount | rand }}</dd> }
          @if (w.kind !== 'approval') { <dt>Assigned to</dt><dd>{{ assignee() }}</dd> }
          <dt>Due</dt><dd>{{ formatDate(w.dueAt) }}</dd>
          <dt>Created</dt><dd>{{ formatDate(w.createdAt) }}</dd>
        </dl>

        <p class="hint">
          <ion-icon name="information-circle-outline" aria-hidden="true" />
          The full record (timeline, documents, messages) arrives with its workflow slice. “Open” takes you to its page.
        </p>

        @if (w.kind !== 'approval') {
          <div drawerFooter class="footer">
            @if (!session.can('Work.Manage')) {
              <span class="muted small">Read-only.</span>
            } @else if (w.status === 'open') {
              <button type="button" class="btn btn-primary" (click)="complete()">
                <ion-icon name="checkmark-outline" aria-hidden="true" /> Mark done
              </button>
              @if (session.isStaff()) {
                <button type="button" class="btn btn-secondary" [cdkMenuTriggerFor]="assignMenu">Assign…</button>
              }
            } @else {
              <button type="button" class="btn btn-secondary" (click)="reopen()">Reopen</button>
            }
          </div>
        }
      </ui-drawer>

      <ng-template #assignMenu>
        <div class="menu-panel" cdkMenu>
          <button type="button" class="menu-item" cdkMenuItem (cdkMenuItemTriggered)="assign(myStaffId())">Assign to me</button>
          <div class="menu-divider"></div>
          @for (s of staff; track s.id) {
            <button type="button" class="menu-item" cdkMenuItem (cdkMenuItemTriggered)="assign(s.id)">
              {{ s.name }} <span class="menu-item-meta">{{ s.title }}</span>
            </button>
          }
        </div>
      </ng-template>
    } @else {
      <ui-drawer title="Item no longer available">
        <p class="detail">This item was removed or you no longer have access to it.</p>
      </ui-drawer>
    }
  `,
  styles: `
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); margin-top: var(--s-2); font-size: var(--fs-sm); }
    .detail { color: var(--c-text-2); }
    .facts { display: grid; grid-template-columns: 120px 1fr; gap: var(--s-2) var(--s-4); margin: var(--s-6) 0 0; padding-top: var(--s-5); border-top: 1px solid var(--c-border); font-size: var(--fs-sm); }
    dt { color: var(--c-text-muted); }
    dd { margin: 0; }
    .hint { display: flex; gap: var(--s-2); margin-top: var(--s-6); font-size: var(--fs-xs); color: var(--c-text-muted); }
    .hint ion-icon { flex: none; margin-top: 2px; font-size: 15px; }
    .footer { display: contents; }
  `,
})
export class WorkItemPreview {
  private readonly data = inject<{ id: string }>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  protected readonly session = inject(SessionService);
  private readonly attention = inject(AttentionService);
  private readonly scope = inject(ScopeService);
  private readonly feedback = inject(FeedbackService);

  protected readonly staff = STAFF;
  protected readonly formatDate = formatDate;

  /** Live: reflects decisions/completions made while the drawer is open. */
  protected readonly item = computed(() => this.attention.visible().find((w) => w.id === this.data.id));
  protected readonly view = computed(() => (this.item() ? workItemView(this.item()!) : null));
  protected readonly scheme = computed(() => this.scope.findScheme(this.item()?.schemeId));
  protected readonly assignee = computed(() => personName(this.item()?.assigneeId));
  protected readonly myStaffId = computed(() => this.session.persona().staffId ?? this.session.persona().id);

  protected complete(): void {
    const id = this.data.id;
    this.attention.complete([id]).subscribe({
      next: () => this.feedback.success('Marked as done', () => this.attention.reopen([id]).subscribe()),
      error: () => this.feedback.error('Couldn’t update the task. Try again.'),
    });
  }

  protected reopen(): void {
    this.attention.reopen([this.data.id]).subscribe();
  }

  protected assign(staffId: string): void {
    this.attention.assign([this.data.id], staffId).subscribe({
      next: () => this.feedback.success(`Assigned to ${personName(staffId)}`),
      error: () => this.feedback.error('Couldn’t reassign. Try again.'),
    });
  }
}
