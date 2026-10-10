import { Injectable, Type, inject } from '@angular/core';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';

/**
 * Preview drawer: opens any record's summary on the right without leaving the
 * current list, so agents keep their place (filters, scroll, selection).
 * Content components read their input via `inject(DIALOG_DATA)` and render a <ui-drawer>.
 */
@Injectable({ providedIn: 'root' })
export class DrawerService {
  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);
  private current: DialogRef<unknown, unknown> | null = null;

  open<C, D>(component: Type<C>, data: D, ariaLabel: string): DialogRef<unknown, C> {
    // One drawer at a time: opening another replaces it (like moving through rows).
    this.current?.close();
    const ref = this.dialog.open<unknown, D, C>(component, {
      data,
      ariaLabel,
      width: 'min(var(--drawer-w), 100vw)',
      height: '100%',
      maxWidth: '100vw',
      positionStrategy: this.overlay.position().global().right('0').top('0'),
      panelClass: 'ui-drawer-pane',
      backdropClass: 'ui-drawer-backdrop',
      restoreFocus: true,
      autoFocus: 'dialog',
    });
    this.current = ref as DialogRef<unknown, unknown>;
    ref.closed.subscribe(() => {
      if (this.current === (ref as DialogRef<unknown, unknown>)) this.current = null;
    });
    return ref;
  }

  close(): void {
    this.current?.close();
  }
}
