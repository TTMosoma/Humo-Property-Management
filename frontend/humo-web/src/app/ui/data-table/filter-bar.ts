import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { CdkMenu, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { IonIcon } from '@ionic/angular/standalone';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDef {
  key: string;
  label: string;
  options: FilterOption[];
}

/**
 * Search box + filter chips. Values live in the page's URL-synced state
 * (see urlState), so a filtered view can be bookmarked or shared.
 */
@Component({
  selector: 'ui-filter-bar',
  imports: [IonIcon, CdkMenu, CdkMenuItemRadio, CdkMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="search">
      <ion-icon name="search-outline" aria-hidden="true" />
      <span class="visually-hidden">{{ searchLabel() }}</span>
      <input type="search" [placeholder]="searchLabel()" [value]="search()" (input)="search.set($any($event.target).value)" />
    </label>

    @for (f of filters(); track f.key) {
      @let current = values()[f.key];
      <button type="button" class="chip" [class.on]="!!current" [cdkMenuTriggerFor]="menu" [attr.aria-label]="f.label + ': ' + labelFor(f, current)">
        <span class="chip-key">{{ f.label }}</span>
        @if (current) {
          <span class="chip-value">{{ labelFor(f, current) }}</span>
        }
        <ion-icon name="chevron-down-outline" aria-hidden="true" />
      </button>
      <ng-template #menu>
        <div class="menu-panel filter-menu" cdkMenu>
          <button type="button" class="menu-item" cdkMenuItemRadio [cdkMenuItemChecked]="!current" (cdkMenuItemTriggered)="set(f.key, null)">
            <span>Any {{ f.label.toLowerCase() }}</span>
            @if (!current) { <ion-icon class="menu-item-meta" name="checkmark-outline" aria-hidden="true" /> }
          </button>
          <div class="menu-divider"></div>
          @for (o of f.options; track o.value) {
            <button type="button" class="menu-item" cdkMenuItemRadio [cdkMenuItemChecked]="current === o.value" (cdkMenuItemTriggered)="set(f.key, o.value)">
              <span>{{ o.label }}</span>
              @if (current === o.value) { <ion-icon class="menu-item-meta" name="checkmark-outline" aria-hidden="true" /> }
            </button>
          }
        </div>
      </ng-template>
    }

    @if (activeCount() > 0 || search()) {
      <button type="button" class="clear" (click)="clear()">Clear</button>
    }
    <span class="spacer"></span>
    <ng-content />
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin-bottom: var(--s-4); }
    .search {
      display: flex; align-items: center; gap: var(--s-2);
      width: 260px; max-width: 100%; height: 34px; padding: 0 var(--s-3);
      background: var(--c-surface); border: 1px solid var(--c-border-strong); border-radius: var(--r);
      color: var(--c-text-muted);
    }
    .search:focus-within { border-color: var(--c-focus); box-shadow: 0 0 0 3px var(--c-accent-soft); }
    .search input { flex: 1; min-width: 0; height: 100%; font: inherit; font-size: var(--fs-sm); color: var(--c-text); background: none; border: 0; outline: none; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      height: 34px; padding: 0 var(--s-3);
      font-size: var(--fs-sm); color: var(--c-text-2);
      background: var(--c-surface); border: 1px dashed var(--c-border-strong); border-radius: var(--r-pill);
      cursor: pointer;
    }
    .chip:hover { border-color: var(--c-text-muted); }
    .chip.on { border-style: solid; border-color: var(--c-primary); background: var(--c-primary-soft); }
    .chip-key { color: var(--c-text-muted); }
    .chip.on .chip-key::after { content: ':'; }
    .chip-value { font-weight: var(--fw-semibold); color: var(--c-text); }
    .chip ion-icon { font-size: 13px; color: var(--c-text-muted); }
    .clear { padding: 0 var(--s-2); font-size: var(--fs-sm); font-weight: var(--fw-medium); color: var(--c-primary-text); background: none; border: 0; cursor: pointer; }
    .spacer { flex: 1; }
    .filter-menu { max-height: 340px; overflow-y: auto; }
    @media (max-width: 767px) { .search { width: 100%; } }
  `,
})
export class FilterBar {
  readonly filters = input<FilterDef[]>([]);
  readonly values = model<Record<string, string | null>>({});
  readonly search = model('');
  readonly searchLabel = input('Search');

  protected readonly activeCount = computed(() => Object.values(this.values()).filter(Boolean).length);

  protected labelFor(f: FilterDef, value: string | null | undefined): string {
    return f.options.find((o) => o.value === value)?.label ?? 'Any';
  }

  protected set(key: string, value: string | null): void {
    this.values.update((v) => ({ ...v, [key]: value }));
  }

  protected clear(): void {
    this.values.set(Object.fromEntries(this.filters().map((f) => [f.key, null])));
    this.search.set('');
  }
}
