import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The only screen so far: proves the standalone app runs. It names the
 * product and says the platform is being prepared. It deliberately lists no
 * features, because none exist yet.
 */
@Component({
  selector: 'hc-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="bar">
      <div class="brand">
        <img src="brand/humo-wordmark-reverse.png" alt="Humo" height="26" />
        <span class="tag">Contractor</span>
      </div>
    </header>

    <main class="main">
      <section class="hero" aria-labelledby="title">
        <p class="eyebrow">A Humo platform</p>
        <h1 id="title">Humo Contractor</h1>
        <p class="lede">A standalone platform for contractors and service businesses that work with Humo customers.</p>

        <div class="status" role="status">
          <span class="dot" aria-hidden="true"></span>
          <div>
            <strong>The platform foundation is being prepared</strong>
            <span>There’s nothing to sign in to yet. This page will grow as Humo Contractor is built.</span>
          </div>
        </div>
      </section>
    </main>

    <footer class="foot">© {{ year }} Humo · Humo Contractor</footer>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
    .bar {
      display: flex; align-items: center; padding: 16px clamp(16px, 4vw, 40px);
      background: linear-gradient(160deg, var(--brand-navy-900), var(--brand-navy-950));
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand img { display: block; width: auto; }
    .tag {
      padding: 2px 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--brand-leaf-300); border: 1px solid rgba(108, 211, 160, 0.35); border-radius: 999px;
    }
    .main { display: grid; flex: 1; place-items: center; padding: clamp(32px, 8vh, 96px) 16px; }
    .hero { width: min(560px, 100%); text-align: center; }
    .eyebrow { margin: 0 0 12px; font-size: 12px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--c-accent-text); }
    h1 { margin: 0; font-family: var(--font-display); font-size: clamp(34px, 6vw, 48px); font-weight: 500; letter-spacing: -0.015em; line-height: 1.1; }
    .lede { margin: 16px auto 32px; max-width: 460px; font-size: 17px; color: var(--c-text-muted); }
    .status {
      display: flex; gap: 14px; align-items: flex-start; padding: 16px 20px; text-align: left;
      background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px;
    }
    .status div { display: flex; flex-direction: column; gap: 2px; }
    .status span:not(.dot) { font-size: 14px; color: var(--c-text-muted); }
    .dot { flex: none; width: 10px; height: 10px; margin-top: 7px; background: var(--brand-leaf-400); border-radius: 50%; box-shadow: 0 0 0 5px var(--c-accent-soft); }
    .foot { padding: 20px 16px; font-size: 12px; text-align: center; color: var(--c-text-faint); }
  `,
})
export class LandingPage {
  protected readonly year = new Date().getFullYear();
}
