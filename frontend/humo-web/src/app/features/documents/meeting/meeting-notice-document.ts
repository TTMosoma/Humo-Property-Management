import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  MEETING_TYPE_LABELS,
  MeetingDetail,
  NOTICE_DAYS,
  OrganisationDocumentSettings,
  ResolvedBranding,
  TemplateDesign,
  isBrandedLayout,
} from '../../../domain';
import { Logo } from '../../../ui/brand/logo';
import { formatDate } from '../../../ui/format/money';
import { clockTime, longDate, sheetStyle } from '../document-sheet';

/**
 * Notice of a meeting ("meeting-notice/classic" and "/branded"): who is
 * called, when and where, the numbered agenda, and the notice period the
 * scheme's rules require. Same A4 sheet as every Humo document.
 */
@Component({
  selector: 'app-meeting-notice-document',
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
          <div class="agency">{{ d.agencyName }}</div>
          <div class="agency-sub">Managing agent for {{ d.scheme.name }} · {{ d.scheme.type }}</div>
          <div class="agency-sub">{{ settings().contact.email }} · {{ settings().contact.phone }}</div>
        </div>
        <div class="doc">
          <div class="doc-title">{{ title() }}</div>
          <div class="doc-period">{{ typeLabel() }}</div>
          <div class="doc-no">{{ m.ref }}</div>
        </div>
      </header>

      @if (!m.notice) {
        <p class="draft-banner">Draft — this notice has not been sent.</p>
      }

      <section class="parties keep">
        <div>
          <div class="label">To</div>
          <div class="strong">{{ m.type === 'trustee' ? 'The trustees of ' + d.scheme.name : 'All owners of ' + d.scheme.name }}</div>
          <div>{{ d.scheme.suburb }}, {{ d.scheme.city }}</div>
        </div>
        <dl class="refs">
          <dt>Date</dt><dd>{{ longDate(m.scheduledFor) }}</dd>
          <dt>Time</dt><dd>{{ clockTime(m.scheduledFor) }}</dd>
          <dt>Venue</dt><dd>{{ m.venue }}</dd>
          <dt>Notice given</dt><dd>{{ m.notice ? formatDate(m.notice.sentAt) : '—' }}</dd>
        </dl>
      </section>

      <p class="lead">
        Notice is given of a {{ typeLabel().toLowerCase() }} of {{ d.scheme.name }}, to be held on {{ longDate(m.scheduledFor) }} at {{ clockTime(m.scheduledFor) }}, at {{ m.venue }}.
      </p>

      <h2 class="section-h">Agenda</h2>
      <ol class="agenda">
        @for (a of m.agenda; track a.id) {
          <li class="keep">
            <span class="a-title">{{ a.title }}</span>
            @if (a.notes) {
              <span class="a-notes">{{ a.notes }}</span>
            }
          </li>
        }
      </ol>

      @if (m.type !== 'trustee') {
        <section class="note keep">
          <div class="label">Proxies and quorum</div>
          <p>Owners who can’t attend may appoint a proxy in writing; proxies must reach the managing agent before the meeting starts. The meeting is quorate when owners holding a third of the votes are present in person or by proxy.</p>
        </section>
      }

      <div class="closing">
        <section class="sign">
          <p>This notice is given at least {{ noticeDays() }} days before the meeting, as the scheme’s rules require.</p>
          <p class="sign-off">For and on behalf of the trustees<br /><strong>{{ m.notice?.sentBy ?? agent() }}</strong><br />{{ d.agencyName }}, managing agent</p>
        </section>
        <footer class="foot">
          <span>{{ design().footerText ?? 'Questions about this meeting? Reply to this email or call your managing agent.' }}</span>
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
export class MeetingNoticeDocument {
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
  protected readonly title = computed(() => this.design().title?.trim() || 'Notice of meeting');
  protected readonly noticeDays = computed(() => NOTICE_DAYS[this.detail().meeting.type]);
  protected readonly agent = computed(() => this.detail().meeting.attendees.find((a) => a.role === 'agent')?.name ?? 'The managing agent');
}
