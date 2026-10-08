import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { DocumentTemplate, Feature, TEMPLATE_TIERS, TemplateAvailability } from '../../domain';
import { CatalogueService } from '../../core/catalogue/catalogue.service';
import { SessionService } from '../../core/session/session.service';

/** One choice in the picker: a real template, or the "your own template" offer for organisations without one. */
interface Choice {
  id: string;
  name: string;
  description: string;
  tierLabel: string;
  state: TemplateAvailability['state'] | 'not-set-up';
  version?: number;
  unlockText?: string;
  unlockFeature?: Feature;
}

/**
 * Pick a template for a document. Available templates can be chosen (and are
 * previewed with the document's real data by the page); locked ones explain
 * how to get them instead of looking broken; planned ones are listed as coming.
 * Used by every document screen and by Settings → Documents & templates.
 */
@Component({
  selector: 'app-template-picker',
  imports: [IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="choices" role="radiogroup" [attr.aria-label]="label()">
      @for (c of choices(); track c.id) {
        <li>
          @if (c.state === 'available') {
            <button type="button" class="choice" role="radio" [attr.aria-checked]="c.id === selected()" [class.on]="c.id === selected()" (click)="choose.emit(c.id)">
              <span class="c-head">
                <span class="c-name">{{ c.name }}</span>
                <span class="c-tier">{{ c.tierLabel }}@if (c.version) { · v{{ c.version }} }</span>
                @if (c.id === selected()) {
                  <ion-icon name="checkmark-outline" class="tick" aria-hidden="true" />
                }
              </span>
              <span class="c-desc">{{ c.description }}</span>
              @if (c.id === defaultId()) {
                <span class="c-note">Your default for new documents</span>
              }
            </button>
          } @else {
            <div class="choice locked" [attr.aria-disabled]="true">
              <span class="c-head">
                <span class="c-name">{{ c.name }}</span>
                <span class="c-tier">{{ c.tierLabel }}</span>
                <ion-icon [name]="c.state === 'planned' ? 'time-outline' : 'lock-closed-outline'" class="tick muted" aria-hidden="true" />
              </span>
              <span class="c-desc">{{ c.description }}</span>
              <span class="c-note">{{ c.unlockText }}</span>
              @if (c.state === 'locked' && c.unlockFeature) {
                @if (canExplore()) {
                  <a class="btn btn-ghost btn-sm explore" routerLink="/settings/plan" [queryParams]="{ feature: c.unlockFeature }">Explore {{ explore(c) }}</a>
                } @else {
                  <span class="c-note">Ask your agency administrator.</span>
                }
              }
            </div>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    .choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
    .choice {
      display: flex; flex-direction: column; gap: 2px; width: 100%; height: 100%; padding: var(--s-3);
      text-align: left; font: inherit; color: var(--c-text); background: var(--c-surface);
      border: 1px solid var(--c-border); border-radius: var(--r);
    }
    button.choice { cursor: pointer; }
    button.choice:hover { border-color: var(--c-border-strong, var(--c-text-muted)); }
    .choice.on { border-color: var(--c-primary); box-shadow: 0 0 0 1px var(--c-primary); }
    .choice.locked { background: var(--c-surface-2, var(--c-surface)); }
    .c-head { display: flex; align-items: baseline; gap: var(--s-2); }
    .c-name { font-weight: var(--fw-semibold); }
    .c-tier { font-size: var(--fs-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-text-muted); }
    .tick { margin-left: auto; color: var(--c-primary); }
    .tick.muted { color: var(--c-text-muted); }
    .c-desc { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .c-note { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .explore { align-self: flex-start; margin-top: var(--s-1); padding-inline: 0; }
  `,
})
export class TemplatePicker {
  private readonly catalogue = inject(CatalogueService);
  private readonly session = inject(SessionService);

  readonly options = input.required<TemplateAvailability[]>();
  readonly selected = input<string | null>(null);
  readonly defaultId = input<string | null>(null);
  readonly label = input('Template');
  /** Also list planned templates (Settings shows the roadmap; document screens don't). */
  readonly showPlanned = input(false);
  readonly choose = output<string>();

  // Staff can read Plan & features (where nudges lead); only administrators can ask Humo for more there.
  protected readonly canExplore = computed(() => this.session.canOpen('Subscription.View'));

  protected readonly choices = computed<Choice[]>(() => {
    const list = this.options().filter((o) => o.state !== 'deprecated' && (this.showPlanned() || o.state !== 'planned'));
    const out = list.map((o) => this.toChoice(o));
    // Organisations without their own template still see what Enterprise custom templates are.
    if (!list.some((o) => o.template.tier === 'custom')) {
      const entitled = this.session.hasFeature(TEMPLATE_TIERS.custom.feature!);
      out.push({
        id: 'custom-offer',
        name: 'Enterprise custom',
        description: 'Create documents using your organisation’s own branding and layout.',
        tierLabel: TEMPLATE_TIERS.custom.label,
        state: entitled ? 'not-set-up' : 'locked',
        unlockFeature: entitled ? undefined : TEMPLATE_TIERS.custom.feature!,
        unlockText: entitled ? 'Included in your plan. Your Humo account manager sets it up with you.' : this.availableWith(TEMPLATE_TIERS.custom.feature!),
      });
    }
    return out;
  });

  private toChoice(o: TemplateAvailability): Choice {
    const t: DocumentTemplate = o.template;
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      tierLabel: t.name === TEMPLATE_TIERS[t.tier].label ? 'Humo' : TEMPLATE_TIERS[t.tier].label,
      state: o.state,
      version: o.state === 'available' && t.tier === 'custom' ? t.currentVersion : undefined,
      unlockFeature: o.unlock,
      unlockText: o.state === 'planned' ? 'Coming later.' : o.unlock ? this.availableWith(o.unlock) : undefined,
    };
  }

  /** "Available with Humo Professional or the Document & Branding Pack" — from the catalogue, not hard-coded. */
  private availableWith(feature: Feature): string {
    const pkg = this.catalogue.tierOf(feature);
    const addOn = this.catalogue.addOnFor(feature);
    const via = [pkg?.name.replace('Humo ', ''), addOn ? `the ${addOn.name}` : null].filter(Boolean).join(' or ');
    return via ? `Available with ${via}.` : 'Not included in your plan.';
  }

  protected explore(c: Choice): string {
    return (c.unlockFeature && this.catalogue.tierOf(c.unlockFeature)?.name.replace('Humo ', '')) || 'plans';
  }
}
