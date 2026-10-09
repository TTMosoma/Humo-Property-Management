import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CollectionStep, CollectionView, OrganisationDocumentSettings, ResolvedBranding, TemplateDesign, isBrandedLayout } from '../../../domain';
import { Logo } from '../../../ui/brand/logo';
import { RandPipe, formatDate } from '../../../ui/format/money';
import { sheetStyle } from '../document-sheet';

const TITLE = { reminder: 'Payment reminder', 'final-demand': 'Final demand', 'letter-of-demand': 'Letter of demand' } as const;

/**
 * Credit control letters ("payment-notice/classic" and "/branded"): what is
 * overdue and since when, how to pay, and what happens next — firmer at each
 * step. Rendered with the figures as they were when the letter was sent.
 */
@Component({
  selector: 'app-payment-notice-document',
  imports: [Logo, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../document-sheet.scss', '../meeting/meeting-documents.scss', './payment-notice-document.scss'],
  template: `
    @let v = view();
    @let l = letter();
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
          <div class="agency">{{ v.agencyName }}</div>
          <div class="agency-sub">Managing agent for {{ v.scheme.name }} · {{ v.scheme.type }}</div>
          <div class="agency-sub">{{ settings().contact.email }} · {{ settings().contact.phone }}</div>
        </div>
        <div class="doc">
          <div class="doc-title">{{ design().title?.trim() || 'Levy account' }}</div>
          <div class="doc-period">{{ title() }}</div>
          <div class="doc-no">{{ formatDate(step().at) }}</div>
        </div>
      </header>

      <section class="parties keep">
        <div>
          <div class="label">To</div>
          <div class="strong">{{ v.holder.displayName }}</div>
          <div>Unit {{ v.unit.number }}, {{ v.scheme.name }}</div>
          <div>{{ v.scheme.suburb }}, {{ v.scheme.city }}</div>
        </div>
        <dl class="refs">
          <dt>Account number</dt><dd>{{ v.account.accountNo }}</dd>
          <dt>Overdue</dt><dd class="strong">{{ l.amount | rand }}</dd>
          <dt>Pay by</dt><dd>{{ formatDate(l.dueBy) }}</dd>
        </dl>
      </section>

      <p class="lead">Dear {{ v.holder.displayName }},</p>
      @switch (l.kind) {
        @case ('reminder') {
          <p class="body">Our records show that <strong>{{ l.amount | rand }}</strong> on your levy account for unit {{ v.unit.number }} is overdue. If you’ve already paid, thank you, and please ignore this reminder. If not, please pay by <strong>{{ formatDate(l.dueBy) }}</strong>.</p>
          <p class="body">If something has made it hard to pay, contact us: we can usually agree a payment arrangement.</p>
        }
        @case ('final-demand') {
          <p class="body">Despite our reminder, <strong>{{ l.amount | rand }}</strong> remains overdue on your levy account for unit {{ v.unit.number }}. Please pay it in full by <strong>{{ formatDate(l.dueBy) }}</strong>.</p>
          <p class="body">If you can’t, contact us before then to agree a payment arrangement. If we don’t hear from you, the trustees may instruct a letter of demand, and collection costs may be charged to your account as the scheme’s rules allow.</p>
        }
        @case ('letter-of-demand') {
          <p class="body">The trustees of {{ v.scheme.name }} have instructed us to demand payment of <strong>{{ l.amount | rand }}</strong>, overdue on your levy account for unit {{ v.unit.number }}.</p>
          <p class="body">Unless payment is received by <strong>{{ formatDate(l.dueBy) }}</strong>, the account will be handed to the scheme’s attorneys for collection without further notice, and legal and collection costs will be recovered from you as the scheme’s rules and the law allow.</p>
        }
      }

      <h2 class="section-h keep-next">What’s overdue</h2>
      <table class="lines ageing">
        <thead>
          <tr><th class="end">Current</th><th class="end">30 days</th><th class="end">60 days</th><th class="end">90 days</th><th class="end">120+ days</th></tr>
        </thead>
        <tbody>
          <tr>
            <td class="end money">{{ l.ageing.current | rand }}</td>
            <td class="end money">{{ l.ageing.d30 | rand }}</td>
            <td class="end money">{{ l.ageing.d60 | rand }}</td>
            <td class="end money">{{ l.ageing.d90 | rand }}</td>
            <td class="end money">{{ l.ageing.d120 | rand }}</td>
          </tr>
        </tbody>
      </table>

      <div class="closing">
        <section class="pay-box">
          <div class="label">How to pay</div>
          <div>EFT to <strong>{{ v.payTo.accountName }}</strong></div>
          <div>{{ v.payTo.bank }} · Account {{ v.payTo.accountNumber }} · Branch {{ v.payTo.branchCode }}</div>
          <div>Use reference <strong>{{ v.account.accountNo }}</strong> so we can match your payment.</div>
        </section>
        <section class="sign">
          <p class="sign-off">Yours faithfully<br /><strong>{{ step().by }}</strong><br />{{ v.agencyName }}, for the trustees of {{ v.scheme.name }}</p>
        </section>
        <footer class="foot">
          <span>{{ design().footerText ?? 'Questions about your account? Reply to this letter or call your managing agent.' }}</span>
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
export class PaymentNoticeDocument {
  readonly view = input.required<CollectionView>();
  readonly step = input.required<CollectionStep>();
  readonly design = input.required<TemplateDesign>();
  readonly branding = input.required<ResolvedBranding>();
  readonly settings = input.required<OrganisationDocumentSettings>();

  protected readonly formatDate = formatDate;
  protected readonly letter = computed(() => this.step().letter!);
  protected readonly branded = computed(() => isBrandedLayout(this.design().layout));
  protected readonly style = computed(() => sheetStyle(this.branding()));
  protected readonly title = computed(() => TITLE[this.letter().kind]);
}
