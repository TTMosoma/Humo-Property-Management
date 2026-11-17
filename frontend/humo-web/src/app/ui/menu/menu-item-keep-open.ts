import { Directive } from '@angular/core';
import { CdkMenuItem } from '@angular/cdk/menu';

/**
 * A menu item that does its job and leaves the menu open, e.g. *Mark read* on one notification, so several can be cleared
 * in a row. It's still a menu item: arrow keys reach it and Enter or Space triggers it.
 */
@Directive({
  selector: '[uiMenuItemKeepOpen]',
  providers: [{ provide: CdkMenuItem, useExisting: MenuItemKeepOpen }],
})
export class MenuItemKeepOpen extends CdkMenuItem {
  override trigger(options?: { keepOpen: boolean }): void {
    super.trigger({ ...options, keepOpen: true });
  }
}
