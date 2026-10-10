import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import {
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_TYPE,
  ComplianceDataSource,
  ComplianceDetail,
  ComplianceType,
  LibraryDataSource,
  LibraryDocument,
  MeetingDataSource,
} from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { scheduleMeetingForm } from '../governance/meeting-forms';
import { uploadForm } from '../library/library-forms';
import { expiryLabel } from '../library/library-view';
import { completeManualForm, recordForm } from './compliance-forms';
import { STATUS_TONE, statusLabel, whenLabel } from './compliance-view';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * One compliance item: where it stands, where Humo got that from (with a link
 * to the source record), the evidence, and the one thing to do next.
 */
@Component({
  selector: 'app-compliance-item-page',
  imports: [RecordHeader, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this item" (retry)="result.retry()" /></div>
    } @else if (result.value() === false) {
      <div class="surface">
        <ui-empty-state illustration="not-found" title="We couldn’t find that compliance item">
          <a class="btn btn-primary" routerLink="/compliance">Compliance</a>
        </ui-empty-state>
      </div>
    } @else {
      @let d = detail()!;
      @let i = d.item;
      <ui-record-header [eyebrow]="i.ref + ' · ' + typeLabel()" [title]="i.title" [subtitle]="d.scheme.name" [status]="status()" [facts]="facts()" [chain]="chain()" />

      <div class="grid">
        <div class="main">
          <section class="surface panel next" [class]="'surface panel next ' + i.status">
            <h2 class="section-title">{{ heading() }}</h2>
            <p>{{ i.detail }}</p>
            @if (i.next && canAct()) {
              <div class="actions">
                @switch (i.next.action) {
                  @case ('upload') {
                    <button type="button" class="btn btn-primary" (click)="upload()"><ion-icon name="cloud-upload-outline" aria-hidden="true" /> {{ i.next.label }}</button>
                    @if (i.type === 'financial-statements') {
                      <button type="button" class="btn btn-secondary" (click)="record()">Record the sign-off instead</button>
                    }
                  }
                  @case ('record') {
                    <button type="button" class="btn btn-primary" (click)="record()">{{ i.next.label }}</button>
                  }
                  @case ('schedule-agm') {
                    <button type="button" class="btn btn-primary" (click)="scheduleAgm()"><ion-icon name="calendar-outline" aria-hidden="true" /> {{ i.next.label }}</button>
                    <button type="button" class="btn btn-ghost" (click)="record()">It was held outside Humo PM</button>
                  }
                  @case ('open-meeting') {
                    @if (i.evidence?.route) {
                      <a class="btn btn-primary" [routerLink]="i.evidence!.route">{{ i.next.label }}</a>
                    } @else {
                      <a class="btn btn-primary" routerLink="/governance/meetings">{{ i.next.label }}</a>
                    }
                  }
                  @case ('open-board') {
                    <a class="btn btn-primary" [routerLink]="i.source.route ?? '/governance/trustees'">{{ i.next.label }}</a>
                  }
                  @case ('open-suppliers') {
                    <a class="btn btn-primary" [routerLink]="i.source.route ?? '/suppliers'">{{ i.next.label }}</a>
                  }
                  @case ('complete-manual') {
                    <button type="button" class="btn btn-primary" (click)="completeManual()">{{ i.next.label }}</button>
                  }
                }
              </div>
            }
            @if (i.workItemId) {
              <p class="muted task"><ion-icon name="checkbox-outline" aria-hidden="true" /> On Tasks for the scheme’s portfolio manager until it’s complete.</p>
            }
          </section>

          @if (i.evidence; as e) {
            <section class="surface panel">
              <h2 class="section-title">Evidence</h2>
              <p>
                @if (e.route) {
                  <a [routerLink]="e.route">{{ e.label }}</a>
                } @else {
                  {{ e.label }}
                }
                @if (e.at) { <span class="muted"> · {{ formatDate(e.at) }}@if (e.by) { , {{ e.by }} }</span> }
              </p>
            </section>
          }

          @if (d.documents.length) {
            <section class="surface panel">
              <h2 class="section-title">Documents</h2>
              <ul class="docs">
                @for (doc of d.documents; track doc.id) {
                  <li [class.archived]="!!doc.archived">
                    <ion-icon [name]="doc.archived ? 'archive-outline' : 'document-text-outline'" aria-hidden="true" />
                    <div class="d-main">
                      <a [routerLink]="['/documents', doc.id]">{{ doc.title }}</a>
                      <div class="muted">{{ docLine(doc) }}</div>
                    </div>
                    @if (!doc.archived && expiry(doc); as x) {
                      <ui-status-pill [label]="x.label" [tone]="x.tone" />
                    }
                  </li>
                }
              </ul>
            </section>
          }

          @if (d.history.length) {
            <section class="surface panel">
              <h2 class="section-title">Previous years</h2>
              <ul class="history">
                @for (h of d.history; track h.at) {
                  <li><span>{{ h.label }}</span><span class="muted">{{ formatDate(h.at) }}@if (h.by) { · {{ h.by }} }</span></li>
                }
              </ul>
            </section>
          }
        </div>

        <aside class="side">
          <section class="surface panel">
            <h2 class="section-title">About this item</h2>
            <p>{{ description() }}</p>
            <dl>
              <dt>Comes from</dt>
              <dd>
                @if (i.source.route) {
                  <a [routerLink]="sourcePath()" [queryParams]="sourceQuery()">{{ i.source.label }}</a>
                } @else {
                  {{ i.source.label }}
                }
              </dd>
              <dt>Financial year-end</dt><dd>{{ fye() }}</dd>
              <dt>Lifts</dt><dd>{{ d.profile.hasLifts ? 'Yes' : 'No' }}</dd>
            </dl>
            <p class="muted small">Humo Property Management tracks deadlines from your records and makes no claim of legal sufficiency.</p>
          </section>
        </aside>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--s-4); align-items: start; }
    .main, .side { display: flex; flex-direction: column; gap: var(--s-4); min-width: 0; }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    p { margin: 0 0 var(--s-2); }
    .next { border-left: 4px solid var(--c-border); }
    .next.overdue { border-left-color: var(--c-danger); }
    .next.due-soon { border-left-color: var(--c-warning); }
    .next.complete { border-left-color: var(--c-success); }
    .next.upcoming { border-left-color: var(--c-info); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-3); }
    .task { display: flex; gap: var(--s-1); align-items: center; margin-top: var(--s-3); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .small { font-size: var(--fs-xs); }
    .docs, .history { margin: 0; padding: 0; list-style: none; }
    .docs li { display: flex; gap: var(--s-2); align-items: flex-start; padding: var(--s-2) 0; border-top: 1px solid var(--c-border); }
    .docs li > ion-icon { flex: none; margin-top: 2px; color: var(--c-text-muted); }
    .docs li.archived { opacity: 0.7; }
    .d-main { flex: 1; min-width: 0; }
    .history li { display: flex; justify-content: space-between; gap: var(--s-3); padding: var(--s-2) 0; border-top: 1px solid var(--c-border); font-size: var(--fs-sm); }
    dl { display: grid; grid-template-columns: 130px 1fr; gap: var(--s-2) var(--s-3); margin: var(--s-3) 0; font-size: var(--fs-sm); }
    dt { color: var(--c-text-muted); }
    dd { margin: 0; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class ComplianceItemPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(ComplianceDataSource);
  private readonly library = inject(LibraryDataSource);
  private readonly meetings = inject(MeetingDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('itemId')!)), { initialValue: this.route.snapshot.paramMap.get('itemId')! });
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly detail = computed<ComplianceDetail | undefined>(() => this.result.value() || undefined);

  protected readonly formatDate = formatDate;
  protected readonly expiry = expiryLabel;

  protected readonly typeLabel = computed(() => {
    const t = this.detail()?.item.type;
    return !t ? '' : t === 'manual' ? 'Added item' : COMPLIANCE_TYPE[t].label;
  });
  protected readonly description = computed(() => {
    const t = this.detail()?.item.type;
    return !t ? '' : t === 'manual' ? 'An item added by your team, for a deadline Humo Property Management doesn’t work out from your records.' : COMPLIANCE_TYPE[t].description;
  });
  protected readonly status = computed(() => {
    const i = this.detail()?.item;
    return i ? { label: statusLabel(i.status), tone: STATUS_TONE[i.status] } : null;
  });
  protected readonly heading = computed(() => {
    const i = this.detail()?.item;
    if (!i) return '';
    return { complete: 'Complete', upcoming: 'Not due yet', 'due-soon': 'Due soon', overdue: 'Overdue', 'not-applicable': 'Not applicable' }[i.status];
  });
  protected readonly fye = computed(() => {
    const p = this.detail()?.profile;
    if (!p) return '';
    const last = new Date(2001, p.financialYearEnd, 0).getDate();
    return `${last} ${MONTHS[p.financialYearEnd - 1]}`;
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const i = d.item;
    const tone = i.status === 'overdue' ? 'danger' : i.status === 'due-soon' ? 'warning' : i.status === 'complete' ? 'success' : 'default';
    return [
      { label: i.status === 'complete' && i.dueAt && i.type !== 'manual' && COMPLIANCE_CATEGORIES[i.type as ComplianceType] ? 'Current until' : 'Due', value: i.dueAt ? formatDate(i.dueAt) : '—', hint: whenLabel(i) || undefined, tone },
      { label: 'Financial year', value: i.period ?? '—' },
      { label: 'Evidence', value: i.evidence ? 'On record' : 'None yet', tone: i.evidence ? 'success' : 'default' },
      { label: 'Task', value: i.workItemId ? 'Open' : '—' },
    ];
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const d = this.detail();
    if (!d) return [];
    return [
      { kind: 'Scheme', label: d.scheme.name, route: `/schemes/${d.scheme.id}/overview` },
      { kind: 'Compliance', label: 'Compliance', route: `/schemes/${d.scheme.id}/compliance` },
      { kind: 'Item', label: d.item.ref },
    ];
  });

  /** Source routes may carry a query string ("/documents?scheme=…"). */
  protected readonly sourcePath = computed(() => (this.detail()?.item.source.route ?? '').split('?')[0]);
  protected readonly sourceQuery = computed(() => {
    const q = (this.detail()?.item.source.route ?? '').split('?')[1];
    return q ? Object.fromEntries(new URLSearchParams(q)) : {};
  });

  protected readonly canAct = computed(() => {
    const action = this.detail()?.item.next?.action;
    if (this.session.readOnly() || !action) return false;
    if (action === 'upload') return this.session.can('Documents.Manage') && this.session.hasFeature('documents');
    if (action === 'schedule-agm') return this.session.can('Meetings.Manage') && this.session.hasFeature('governance');
    if (action === 'open-meeting' || action === 'open-suppliers' || action === 'open-board') return true;
    return this.session.can('Compliance.Manage');
  });

  protected docLine(doc: LibraryDocument): string {
    return doc.archived ? `Archived: ${doc.archived.reason}` : `Uploaded ${formatDate(doc.uploadedAt, true)} by ${doc.uploadedBy}`;
  }

  protected upload(): void {
    const d = this.detail()!;
    const type = d.item.type as ComplianceType;
    uploadForm(this.drawer, this.library, { kind: 'scheme', id: d.scheme.id, label: d.scheme.name }, { category: COMPLIANCE_CATEGORIES[type], compliance: type, title: type === 'financial-statements' ? `Audited financial statements ${d.item.period}` : undefined });
  }

  protected record(): void {
    const d = this.detail()!;
    recordForm(this.drawer, this.data, d.item, d.scheme.name);
  }

  protected scheduleAgm(): void {
    const d = this.detail()!;
    scheduleMeetingForm(this.drawer, this.meetings, this.router, [d.scheme], d.scheme.id, 'agm');
  }

  protected completeManual(): void {
    completeManualForm(this.drawer, this.data, this.detail()!.item);
  }
}
