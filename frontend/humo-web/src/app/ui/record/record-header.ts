import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { StatusPill, Tone } from '../status-pill/status-pill';
import { ChainLink, RelationshipChain } from './relationship-chain';

export interface KeyFact {
  label: string;
  value: string;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  hint?: string;
}

/**
 * Record page anatomy (pattern P1), used for every entity: scheme, unit, person,
 * account, job, supplier, meeting. Identity + status + key facts + relationships
 * + primary actions, always in the same places.
 *
 *   <ui-record-header …>
 *     <ui-scheme-art recordArt … />
 *     <button recordActions …>…</button>
 *   </ui-record-header>
 */
@Component({
  selector: 'ui-record-header',
  imports: [StatusPill, RelationshipChain],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="art"><ng-content select="[recordArt]" /></div>
    <div class="main">
      @if (chain().length) {
        <ui-relationship-chain [links]="chain()" [current]="chainCurrent()" />
      }
      <div class="title-row">
        <div class="title-text">
          @if (eyebrow()) {
            <div class="label-caps">{{ eyebrow() }}</div>
          }
          <div class="title-line">
            <h1>{{ title() }}</h1>
            @if (status(); as s) {
              <ui-status-pill [label]="s.label" [tone]="s.tone" />
            }
          </div>
          @if (subtitle()) {
            <p class="subtitle">{{ subtitle() }}</p>
          }
        </div>
        <div class="actions"><ng-content select="[recordActions]" /></div>
      </div>
      @if (facts().length) {
        <dl class="facts">
          @for (f of facts(); track f.label) {
            <div class="fact" [attr.title]="f.hint ? f.value + ' — ' + f.hint : f.value">
              <dt>{{ f.label }}</dt>
              <dd [class]="'tone-' + (f.tone ?? 'default')">{{ f.value }}</dd>
            </div>
          }
        </dl>
      }
    </div>
  `,
  styles: `
    :host { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s-6); margin-bottom: var(--s-5); }
    .art:empty { display: none; }
    .art { width: 220px; height: 150px; border-radius: var(--r-lg); overflow: hidden; border: 1px solid var(--c-border); }
    .art ::ng-deep > * { width: 100%; height: 100%; }
    .main { display: flex; flex-direction: column; gap: var(--s-3); min-width: 0; }
    .title-row { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--s-4); }
    .title-text .label-caps { margin-bottom: var(--s-1); }
    .title-line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
    h1 { font-size: var(--fs-3xl); line-height: 1.15; }
    .subtitle { margin-top: var(--s-1); color: var(--c-text-muted); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .actions:empty { display: none; }
    .facts {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--s-1) var(--s-6);
      margin: var(--s-2) 0 0; padding-top: var(--s-4); border-top: 1px solid var(--c-border);
    }
    .fact { min-width: 0; }
    dt { font-size: var(--fs-xs); color: var(--c-text-muted); }
    dd { margin: 2px 0 0; overflow: hidden; font-family: var(--font-display); font-size: var(--fs-xl); font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; white-space: nowrap; text-overflow: ellipsis; }
    .tone-danger { color: var(--c-danger); }
    .tone-warning { color: var(--c-warning); }
    .tone-success { color: var(--c-success); }
    @media (max-width: 900px) {
      :host { grid-template-columns: 1fr; gap: var(--s-4); }
      .art { width: 100%; height: 110px; }
      h1 { font-size: var(--fs-2xl); }
    }
  `,
})
export class RecordHeader {
  readonly eyebrow = input<string>();
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly status = input<{ label: string; tone: Tone } | null>(null);
  readonly facts = input<KeyFact[]>([]);
  readonly chain = input<ChainLink[]>([]);
  /** Index of this record in the chain (defaults to the last link). */
  readonly chainCurrent = input<number | null>(null);
}
