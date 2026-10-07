import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

/** Custom cell content: `<ng-template uiCell="amount" let-row>…</ng-template>` */
@Directive({ selector: 'ng-template[uiCell]' })
export class CellDef {
  readonly uiCell = input.required<string>();
  readonly template = inject(TemplateRef);
}

export interface ColumnDef<T> {
  key: string;
  header: string;
  align?: 'start' | 'end' | 'center';
  /** CSS width, e.g. '120px' or '30%'. */
  width?: string;
  /** Makes the column sortable. */
  sort?: (row: T) => string | number;
  /**
   * How the cell appears when rows become cards on phones:
   * title (bold, first) · meta (small, muted) · field (label + value) · hidden
   */
  mobile?: 'title' | 'meta' | 'field' | 'hidden';
}

/**
 * The standard Humo table: sortable columns, optional row selection (feeding a
 * bulk-action bar), keyboard-openable rows, an "active" row for the open
 * preview drawer, and a card layout on phones. Filtering lives outside (ui-filter-bar)
 * so the same filters can drive tables, boards and exports.
 */
@Component({
  selector: 'ui-data-table',
  imports: [NgTemplateOutlet, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-table.html',
  styleUrl: './data-table.scss',
})
export class DataTable<T> {
  readonly rows = input.required<T[]>();
  readonly columns = input.required<ColumnDef<T>[]>();
  readonly rowId = input.required<(row: T) => string>();
  readonly caption = input.required<string>();
  readonly selectable = input(false);
  readonly selected = model<string[]>([]);
  readonly activeId = input<string | null>(null);
  /** Rows to de-emphasise (e.g. completed items). */
  readonly muted = input<(row: T) => boolean>(() => false);
  readonly rowClick = output<T>();

  private readonly cells = contentChildren(CellDef);
  protected readonly cellMap = computed(() => new Map(this.cells().map((c) => [c.uiCell(), c.template])));

  protected readonly sortKey = signal<string | null>(null);
  protected readonly sortDir = signal<'asc' | 'desc'>('asc');

  protected readonly sorted = computed(() => {
    const key = this.sortKey();
    const col = this.columns().find((c) => c.key === key);
    if (!col?.sort) return this.rows();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const by = col.sort;
    return [...this.rows()].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  });

  protected readonly selectedSet = computed(() => new Set(this.selected()));
  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((r) => this.selectedSet().has(this.rowId()(r))),
  );
  protected readonly someSelected = computed(() => this.selected().length > 0 && !this.allSelected());

  protected sortBy(col: ColumnDef<T>): void {
    if (!col.sort) return;
    if (this.sortKey() === col.key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(col.key);
      this.sortDir.set(col.align === 'end' ? 'desc' : 'asc');
    }
  }

  protected ariaSort(col: ColumnDef<T>): string | null {
    if (!col.sort) return null;
    if (this.sortKey() !== col.key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? [] : this.rows().map((r) => this.rowId()(r)));
  }

  protected toggle(row: T, e: Event): void {
    e.stopPropagation();
    const id = this.rowId()(row);
    const set = new Set(this.selected());
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.selected.set([...set]);
  }

  protected value(row: T, key: string): unknown {
    return (row as Record<string, unknown>)[key];
  }
}
