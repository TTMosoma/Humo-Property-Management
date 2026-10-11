import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { ContractorProfile, VERIFICATION_LABEL, VerificationLevel } from '../../domain/contractor';

/**
 * How Humo PM shows a business's Humo Contractor profile: verification,
 * reputation and endorsements (quote requests, comparisons, supplier pages).
 * They depend only on the contractor domain.
 */

/** Listed · Verified · Humo Recommended — never a fake check, just the state Humo holds. */
@Component({
  selector: 'ct-verification-badge',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-level]': 'level()' },
  template: `
    <ion-icon [name]="level() === 'recommended' ? 'ribbon' : level() === 'verified' ? 'shield-checkmark' : 'ellipse-outline'" aria-hidden="true" />
    {{ label() }}
  `,
  styles: `
    :host { display: inline-flex; gap: 4px; align-items: center; padding: 2px 9px; font-size: var(--fs-xs); font-weight: var(--fw-semibold); border-radius: var(--r-pill); color: var(--c-text-muted); background: var(--c-surface-sunken); white-space: nowrap; }
    :host([data-level='verified']) { color: var(--c-info); background: var(--c-info-soft); }
    :host([data-level='recommended']) { color: var(--c-success); background: var(--c-success-soft); }
    ion-icon { font-size: 14px; }
  `,
})
export class VerificationBadge {
  readonly level = input.required<VerificationLevel>();
  protected readonly label = computed(() => VERIFICATION_LABEL[this.level()]);
}

/** Reputation as several honest numbers — never one star average on its own. */
@Component({
  selector: 'ct-reputation',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': 'compact()' },
  template: `
    @let r = profile().reputation;
    <div class="stars" [attr.aria-label]="r.rating + ' out of 5 from ' + r.ratingsCount + ' ratings'">
      <ion-icon name="star" aria-hidden="true" /><strong>{{ r.rating.toFixed(1) }}</strong>
      <span class="muted">({{ r.ratingsCount }})</span>
    </div>
    <dl>
      <div><dt>Completed</dt><dd>{{ r.completedJobs }} jobs</dd></div>
      <div><dt>Completion</dt><dd>{{ r.completionRate }}%</dd></div>
      <div><dt>On time</dt><dd>{{ r.onTimeRate }}%</dd></div>
      @if (!compact()) {
        <div><dt>Quote response</dt><dd>{{ r.quoteResponseRate }}% · ~{{ r.medianResponseHours }} h</dd></div>
        <div><dt>Humo customers</dt><dd>{{ r.humoRelationships }}</dd></div>
        <div><dt>Years active</dt><dd>{{ r.yearsActive }}</dd></div>
      }
      <div><dt>Endorsements</dt><dd>{{ r.endorsements }}</dd></div>
    </dl>
  `,
  styles: `
    :host { display: block; }
    .stars { display: flex; gap: 4px; align-items: center; margin-bottom: var(--s-2); font-size: var(--fs-lg); }
    .stars ion-icon { color: #e0a100; }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px var(--s-4); margin: 0; }
    dt { font-size: var(--fs-2xs); letter-spacing: 0.04em; text-transform: uppercase; color: var(--c-text-muted); }
    dd { margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-medium); color: var(--c-text); }
    :host(.compact) .stars { font-size: var(--fs-md); margin-bottom: 4px; }
    :host(.compact) dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  `,
})
export class Reputation {
  readonly profile = input.required<ContractorProfile>();
  readonly compact = input(false);
}

/** "Recommended by Tshikrand, Oakridge Managing Agents and 10 others." */
@Component({
  selector: 'ct-endorsed-by',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (profile().endorsements.length) {
      <ion-icon name="thumbs-up-outline" aria-hidden="true" />
      <span>Endorsed by <strong>{{ names() }}</strong>{{ more() ? ' and ' + more() + ' other Humo customers' : '' }}</span>
    } @else {
      <span class="muted">No endorsements from Humo customers yet</span>
    }
  `,
  styles: `
    :host { display: flex; gap: 6px; align-items: flex-start; font-size: var(--fs-xs); color: var(--c-text-2); }
    ion-icon { flex: none; margin-top: 1px; font-size: 14px; color: var(--c-success); }
    .muted { color: var(--c-text-muted); }
  `,
})
export class EndorsedBy {
  readonly profile = input.required<ContractorProfile>();
  readonly show = input(2);
  protected readonly names = computed(() => this.profile().endorsements.slice(0, this.show()).map((e) => e.fromCustomerName).join(', '));
  protected readonly more = computed(() => Math.max(0, this.profile().endorsements.length - this.show()));
}

export function complianceOk(p: ContractorProfile, now = new Date()): boolean {
  return p.documents.filter((d) => d.type !== 'B-BBEE certificate').every((d) => d.onFile && (!d.expires || new Date(d.expires) > now));
}
