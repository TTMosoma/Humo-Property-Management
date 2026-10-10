import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  MEETING_TYPE_LABELS,
  MeetingDetail,
  OrganisationDocumentSettings,
  ResolutionView,
  ResolvedBranding,
  TemplateDesign,
  isBrandedLayout,
} from '../../../domain';
import { Logo } from '../../../ui/brand/logo';
import { formatDate } from '../../../ui/format/money';
import { clockTime, longDate, sheetStyle } from '../document-sheet';

/**
 * Minutes of a meeting ("meeting-minutes/classic" and "/branded"): who was
 * there, quorum, the minute of each agenda item with the resolutions passed
 * under it (wording and votes), and the actions that followed. Draft minutes
 * say so on the page until the trustees approve them.
 */
@Component({
  selector: 'app-meeting-minutes-document',
  imports: [Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../document-sheet.scss', './meeting-documents.scss'],
  template: `
    @let d = detail();
    @let m = d.meeting;
    @let s = style();
    <article class="sheet" [class.branded]="branded()" [style.--doc-primary]="s.primary" [style.--doc-accent]="s.accent" [style.font-family]="s.font" [style.--font-display]="s.font" [attr.aria-label]="title()">
      @if (branded()) {
        <div class="brand-bar" aria-hidden="true"></div>
      }
      <header class="letterhead">
        <div>
          @if (branded() && branding().logo; as logo) {
            <div class="logo"><span class="logo-mark" aria-hidden="true">{{ logo.text.charAt(0) }}</span>{{ logo.text }}</div>
          }
          <div class="agency">{{ d.scheme.name }}</div>
          <div class="agency-sub">{{ d.scheme.type }} · {{ d.scheme.suburb }}, {{ d.scheme.city }}</div>
          <div class="agency-sub">Managed by {{ d.agencyName }}</div>
        </div>
        <div class="doc">
          <div class="doc-title">{{ title() }}</div>
          <div class="doc-period">{{ typeLabel() }}</div>
          <div class="doc-no">{{ m.ref }} · {{ formatDate(m.held?.at ?? m.scheduledFor) }}</div>
        </div>
      </header>

      @if (!m.minutes?.approvedAt) {
        <p class="draft-banner">Draft — not yet approved by the trustees.</p>
      }

      <section class="parties keep">
        <div class="people">
          <div class="label">Present</div>
          <div>{{ names(true) || '—' }}</div>
          @if (apologies()) {
            <div class="label gap">Apologies</div>
            <div>{{ apologies() }}</div>
          }
          @if (inAttendance()) {
            <div class="label gap">In attendance</div>
            <div>{{ inAttendance() }}</div>
          }
        </div>
        <dl class="refs">
          <dt>Held</dt><dd>{{ formatDate(m.held?.at ?? m.scheduledFor) }}</dd>
          <dt>Time</dt><dd>{{ clockTime(m.scheduledFor) }}</dd>
          <dt>Venue</dt><dd>{{ m.venue }}</dd>
          @if (m.held; as h) {
            <dt>Present</dt><dd>{{ h.present }} of {{ h.voters }} · quorum {{ h.required }}</dd>
          }
        </dl>
      </section>

      @for (a of m.agenda; track a.id; let i = $index) {
        <section class="item">
          <h2 class="section-h keep-next">{{ i + 1 }}. {{ a.title }}</h2>
          <p class="minute">{{ a.minute || 'Noted.' }}</p>
          @for (r of resolutionsFor(a.id); track r.resolution.id) {
            <div class="res keep">
              <div class="res-head">
                <strong>{{ r.resolution.ref }} · {{ r.resolution.title }}</strong>
                <span class="res-out" [class.no]="r.resolution.outcome !== 'passed'">
                  {{ r.resolution.outcome === 'passed' ? 'Passed' : 'Not passed' }}@if (r.resolution.votes; as v) { · {{ v.for }} for, {{ v.against }} against, {{ v.abstain }} abstained }
                </span>
              </div>
              <p>{{ r.resolution.text }}</p>
            </div>
          }
        </section>
      }

      @if (otherResolutions().length) {
        <section class="item">
          <h2 class="section-h keep-next">Other resolutions</h2>
          @for (r of otherResolutions(); track r.resolution.id) {
            <div class="res keep">
              <div class="res-head"><strong>{{ r.resolution.ref }} · {{ r.resolution.title }}</strong></div>
              <p>{{ r.resolution.text }}</p>
            </div>
          }
        </section>
      }

      @if (actions().length) {
        <h2 class="section-h keep-next">Actions</h2>
        <table class="lines">
          <thead>
            <tr><th>Resolution</th><th>Action</th><th>Responsible</th><th class="end">Due</th></tr>
          </thead>
          <tbody>
            @for (x of actions(); track x.id) {
              <tr><td>{{ x.ref }}</td><td>{{ x.title }}</td><td>{{ x.who }}</td><td class="end">{{ formatDate(x.due) }}</td></tr>
            }
          </tbody>
        </table>
      }

      <div class="closing">
        <section class="sign">
          @if (m.minutes?.approvedAt) {
            <p class="sign-off">Approved by <strong>{{ m.minutes!.approvedBy }}</strong> on {{ formatDate(m.minutes!.approvedAt!) }}.</p>
          } @else {
            <div class="sign-lines">
              <span>Chairperson</span><span>Date</span>
            </div>
          }
          <p class="muted">Minutes taken by {{ m.minutes?.draftedBy ?? agentName() }}, {{ d.agencyName }}.</p>
        </section>
        <footer class="foot">
          <span>{{ design().footerText ?? 'These minutes record the decisions of the trustees. Keep them with the scheme’s records.' }}</span>
          <span class="powered">Powered by <ui-logo variant="wordmark" [height]="12" /></span>
        </footer>
        @if (settings().footerText; as line) {
          <p class="org-foot">{{ line }}</p>
        }
        @if (design().legalText; as legal) {
          <p class="legal">{{ legal }}</p>
        }
      </div>
    </article>
  `,
})
export class MeetingMinutesDocument {
  readonly detail = input.required<MeetingDetail>();
  readonly design = input.required<TemplateDesign>();
  readonly branding = input.required<ResolvedBranding>();
  readonly settings = input.required<OrganisationDocumentSettings>();

  protected readonly formatDate = formatDate;
  protected readonly longDate = longDate;
  protected readonly clockTime = clockTime;

  protected readonly branded = computed(() => isBrandedLayout(this.design().layout));
  protected readonly style = computed(() => sheetStyle(this.branding()));
  protected readonly typeLabel = computed(() => MEETING_TYPE_LABELS[this.detail().meeting.type]);
  protected readonly title = computed(() => this.design().title?.trim() || 'Minutes');
  protected readonly agentName = computed(() => this.detail().meeting.attendees.find((a) => a.role === 'agent')?.name ?? 'the managing agent');

  protected names(present: boolean): string {
    return this.detail()
      .meeting.attendees.filter((a) => a.role !== 'agent' && !!a.present === present)
      .map((a) => `${a.name} (${a.capacity})`)
      .join(', ');
  }

  protected readonly apologies = computed(() => (this.detail().meeting.held ? this.names(false) : ''));
  protected readonly inAttendance = computed(() =>
    this.detail()
      .meeting.attendees.filter((a) => a.role === 'agent' && a.present !== false)
      .map((a) => `${a.name} (${a.capacity})`)
      .join(', '),
  );

  protected resolutionsFor(itemId: string): ResolutionView[] {
    return this.detail().resolutionViews.filter((r) => r.resolution.agendaItemId === itemId);
  }

  protected readonly otherResolutions = computed(() => {
    const ids = new Set(this.detail().meeting.agenda.map((a) => a.id));
    return this.detail().resolutionViews.filter((r) => !r.resolution.agendaItemId || !ids.has(r.resolution.agendaItemId));
  });

  protected readonly actions = computed(() =>
    this.detail().resolutionViews.flatMap((r) => r.actions.map((a) => ({ id: a.action.id, ref: r.resolution.ref, title: a.action.title, who: a.assigneeName, due: a.action.dueAt }))),
  );
}
