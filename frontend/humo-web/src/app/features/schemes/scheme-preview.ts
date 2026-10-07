import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { AttentionService } from '../../core/attention/attention.service';
import { ScopeService } from '../../core/scope/scope.service';
import { Drawer } from '../../ui/drawer/drawer';
import { RandPipe, formatDate } from '../../ui/format/money';
import { SchemeArt } from '../../ui/illustration/scheme-art';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { COMPLIANCE, RATING, SchemeRow, collectionTone } from './scheme-view';

/** Quick look at a scheme from the schemes list, without losing the list. */
@Component({
  selector: 'app-scheme-preview',
  imports: [Drawer, SchemeArt, StatusPill, IonIcon, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = row.scheme;
    @let h = row.health;
    <ui-drawer [eyebrow]="s.type" [title]="s.name" [openLink]="'/schemes/' + s.id + '/overview'">
      <div drawerMeta class="meta">
        <ui-status-pill [label]="rating.label" [tone]="rating.tone" />
        <span>{{ s.suburb }}, {{ s.city }} · {{ s.unitCount }} units · Managed by {{ row.manager }}</span>
      </div>

      <ui-scheme-art class="art" [seed]="s.id" [type]="s.type" />

      <dl class="kpis">
        <div><dt>Collections (3 mo.)</dt><dd [class]="collectionTone(h.collectionRate)">{{ h.collectionRate }}%</dd></div>
        <div><dt>Arrears</dt><dd class="money">{{ h.arrears | rand: 'compact' }}</dd></div>
        <div><dt>90+ day accounts</dt><dd>{{ h.accounts90Plus }}</dd></div>
        <div><dt>Monthly levy roll</dt><dd class="money">{{ h.monthlyLevyRoll | rand: 'compact' }}</dd></div>
        <div><dt>Open jobs</dt><dd>{{ h.openJobs }}@if (h.overdueJobs) { <small class="danger"> · {{ h.overdueJobs }} overdue</small> }</dd></div>
        <div><dt>Compliance</dt><dd><ui-status-pill [label]="compliance.label" [tone]="compliance.tone" /></dd></div>
      </dl>

      <section>
        <h3 class="section-title">Needs attention</h3>
        @if (openItems().length) {
          <ul class="items">
            @for (w of openItems().slice(0, 5); track w.id) {
              <li><span class="ref">{{ w.ref }}</span>{{ w.title }}</li>
            }
          </ul>
          @if (openItems().length > 5) {
            <p class="more">and {{ openItems().length - 5 }} more on the scheme overview</p>
          }
        } @else {
          <p class="muted">Nothing outstanding for you in this scheme.</p>
        }
      </section>

      @if (h.nextMeeting; as m) {
        <section>
          <h3 class="section-title">Next meeting</h3>
          <p class="meeting"><ion-icon name="calendar-outline" aria-hidden="true" />{{ m.type }} · {{ formatDate(m.at) }}</p>
        </section>
      }

      <div drawerFooter class="footer">
        <button type="button" class="btn btn-primary" (click)="workOn()">Work on this scheme</button>
        <button type="button" class="btn btn-secondary" (click)="scope.togglePin(s.id)">
          <ion-icon [name]="scope.isPinned(s.id) ? 'star' : 'star-outline'" aria-hidden="true" />
          {{ scope.isPinned(s.id) ? 'Pinned' : 'Pin to sidebar' }}
        </button>
      </div>
    </ui-drawer>
  `,
  styles: `
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); margin-top: var(--s-2); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .art { height: 140px; border-radius: var(--r-lg); overflow: hidden; border: 1px solid var(--c-border); }
    .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s-4) var(--s-6); margin: var(--s-5) 0; }
    dt { font-size: var(--fs-xs); color: var(--c-text-muted); }
    dd { margin: 2px 0 0; font-family: var(--font-display); font-size: var(--fs-xl); font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
    dd small { font-family: var(--font-sans); font-size: var(--fs-xs); }
    .success { color: var(--c-success); } .warning { color: var(--c-warning); } .danger { color: var(--c-danger); }
    section { padding-top: var(--s-4); margin-top: var(--s-4); border-top: 1px solid var(--c-border); }
    .section-title { font-size: var(--fs-md); margin-bottom: var(--s-2); }
    .items { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--s-2); font-size: var(--fs-sm); }
    .ref { display: inline-block; min-width: 92px; color: var(--c-text-muted); font-size: var(--fs-xs); }
    .more, .muted { font-size: var(--fs-sm); color: var(--c-text-muted); margin-top: var(--s-2); }
    .meeting { display: flex; align-items: center; gap: var(--s-2); }
    .footer { display: contents; }
  `,
})
export class SchemePreview {
  protected readonly row = inject<SchemeRow>(DIALOG_DATA);
  protected readonly scope = inject(ScopeService);
  private readonly attention = inject(AttentionService);
  private readonly ref = inject(DialogRef);
  private readonly router = inject(Router);

  protected readonly rating = RATING[this.row.health.rating];
  protected readonly compliance = COMPLIANCE[this.row.health.compliance];
  protected readonly collectionTone = collectionTone;
  protected readonly formatDate = formatDate;

  protected readonly openItems = computed(() => this.attention.openForScheme(this.row.scheme.id));

  protected workOn(): void {
    this.scope.setScope(this.row.scheme.id);
    this.ref.close();
    this.router.navigate(['/schemes', this.row.scheme.id, 'overview']);
  }
}
