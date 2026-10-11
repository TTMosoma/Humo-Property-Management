import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { PRODUCT } from './product/product';

/**
 * "Debtors · Humo Property Management" — the page first so tabs stay
 * distinguishable, then the product (never just "Humo", which is the family).
 */
@Injectable()
export class HumoTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const product = PRODUCT;
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page && page !== product.name ? `${page} · ${product.name}` : product.name);
  }
}
