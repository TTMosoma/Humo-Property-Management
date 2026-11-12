import { Injectable, inject } from '@angular/core';
import { FeedbackService } from './feedback.service';
import { offscreenMessage } from './offscreen-message';

const ALERT = '[role="alert"]';

/**
 * A problem shown where the person can't see it (further down a long page, or scrolled away in a drawer) also comes
 * up as a toast, with *Show* to scroll to it. Problems already on screen don't: the message is right there.
 *
 * It watches for any `role="alert"` element that appears or changes its text, so every screen is covered as long as
 * its problems are marked `role="alert"`. Notes that are on the page from the start (a status, a warning) shouldn't
 * use `role="alert"`.
 */
@Injectable({ providedIn: 'root' })
export class OffscreenAlerts {
  private readonly feedback = inject(FeedbackService);
  private readonly pending = new Set<HTMLElement>();
  private scheduled = false;
  private started = false;

  start(): void {
    if (this.started || typeof MutationObserver === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    this.started = true;
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach((n) => this.collect(n));
        else this.collect(r.target);
      }
      if (this.pending.size) this.schedule();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  private collect(node: Node): void {
    const el = node instanceof Element ? node : node.parentElement;
    if (!el || el.closest('ion-toast')) return;
    const own = el.closest(ALERT);
    if (own instanceof HTMLElement) this.pending.add(own);
    if (node instanceof Element) node.querySelectorAll(ALERT).forEach((a) => a instanceof HTMLElement && this.pending.add(a));
  }

  /** After the page has laid out, so positions are real. */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      const alerts = [...this.pending].filter((a) => a.isConnected && a.textContent?.trim());
      this.pending.clear();
      if (alerts.length) this.check(alerts);
    });
  }

  private check(alerts: HTMLElement[]): void {
    // The first report of an IntersectionObserver says how much of each is visible, taking scrolling areas into account.
    const io = new IntersectionObserver((entries) => {
      io.disconnect();
      const hidden = entries.filter((e) => e.intersectionRatio < 0.5).map((e) => e.target as HTMLElement);
      if (!hidden.length) return;
      const message = offscreenMessage(hidden.map((h) => h.textContent ?? ''));
      if (message) void this.feedback.offscreen(message, () => this.reveal(hidden[0]));
    }, { threshold: [0, 0.5, 1] });
    alerts.forEach((a) => io.observe(a));
  }

  private reveal(alert: HTMLElement): void {
    if (!alert.isConnected) return;
    alert.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!alert.hasAttribute('tabindex')) alert.setAttribute('tabindex', '-1');
    alert.focus({ preventScroll: true });
  }
}
