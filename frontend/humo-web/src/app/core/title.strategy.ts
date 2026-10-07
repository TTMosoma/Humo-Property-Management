import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { HUMO_PRODUCTS, PRODUCT } from './product/product';

/**
 * "Debtors · Humo Property Management" — the page first so tabs stay
 * distinguishable, then the product (never just "Humo", which is the family).
 * The prototyped Humo Contractor portal is titled as its own product.
 */
@Injectable()
export class HumoTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    if (snapshot.url.startsWith('/signed-out')) {
      this.title.setTitle('Signed out · Humo');
      return;
    }
    const product = snapshot.url.startsWith('/contractor') ? HUMO_PRODUCTS.contractor : PRODUCT;
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page && page !== product.name ? `${page} · ${product.name}` : product.name);
  }
}
