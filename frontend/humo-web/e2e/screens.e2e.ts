import { APIRequestContext, Page, expect, test } from '@playwright/test';

/**
 * The screen check (docs/28 §1): every page in each role's menu opens without an error against the live API.
 * It found its first failures before it existed: five screens on 22 October, Levy billing rules on 28 October.
 *
 * The people are the development seed's (`seed-demo`, backend/README) and the bootstrap System Administrator.
 */
const PEOPLE: { email: string; role: string }[] = [
  { email: 'thandeka@acacia.example', role: 'Agency Administrator (Professional)' },
  { email: 'priya@acacia.example', role: 'Finance' },
  { email: 'johan@acacia.example', role: 'Portfolio Manager, one scheme' },
  { email: 'anele@mail.example', role: 'Owner' },
  { email: 'annette@fynbos.example', role: 'Agency Administrator (Essentials)' },
  { email: process.env['E2E_HUMO_ADMIN'] ?? 'terry@humo.co.za', role: 'System Administrator' },
];

const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

/** The newest sign-in link Mailpit caught for this address. */
async function signInToken(request: APIRequestContext, email: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const search = await request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:"${email}"`, limit: '5' } });
    const found = (await search.json()) as { messages: { ID: string; Created: string; Subject: string }[] };
    const message = found.messages.find((m) => m.Subject.includes('sign-in link') && Date.parse(m.Created) >= after - 1000);
    if (message) {
      const text = ((await (await request.get(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as { Text: string }).Text;
      const token = /sign-in\/link\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
      if (token) return token;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-in email reached Mailpit for ${email}`);
}

/** Signs in by email link through the API, as the sign-in page does: the code from the request, the token from the email. */
async function signIn(page: Page, email: string): Promise<void> {
  const request = page.context().request;
  const asked = Date.now();
  const sent = await request.post('/api/auth/link', { data: { email } });
  expect(sent.status(), `asking for a sign-in link for ${email}`).toBe(202);
  const { code } = (await sent.json()) as { code: string };
  const token = await signInToken(request, email, asked);
  const done = await request.post('/api/auth/link/complete', { data: { token, code } });
  expect(done.status(), `completing sign-in for ${email}: ${await done.text()}`).toBe(200);
}

/** Every link in the sidebar, with each group opened (a group shows its links only when open). */
async function menuLinks(page: Page): Promise<string[]> {
  const sidebar = page.locator('app-sidebar');
  await expect(sidebar.locator('a[href]').first()).toBeVisible();
  const read = () => sidebar.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  const hrefs = new Set(await read());
  // Opening a group can close another (one open at a time), so read the links after opening each one. A group is open
  // when its links show (its button's aria-expanded isn't reliable: the flyout menu trigger on it manages that attribute).
  const groups = sidebar.locator('li.group-li');
  for (let i = 0; i < (await groups.count()); i++) {
    const group = groups.nth(i);
    if ((await group.locator('a[href]').count()) === 0) await group.locator(':scope > button').click();
    await expect(group.locator('a[href]').first()).toBeVisible();
    for (const h of await read()) hrefs.add(h);
  }
  return [...hrefs].filter((h) => h.startsWith('/'));
}

/** Waits for the page to settle: no loading skeletons, then no error states. */
async function expectNoError(page: Page, url: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('ui-skeleton'), `${url} is still loading`).toHaveCount(0);
  const errors = page.locator('ui-error-state');
  if ((await errors.count()) > 0) {
    const text = (await errors.first().innerText()).replace(/\s+/g, ' ');
    throw new Error(`${url} shows an error: ${text}`);
  }
}

for (const person of PEOPLE) {
  test(`every menu page opens for ${person.role}`, async ({ page }) => {
    const failures: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 500) failures.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    });
    await signIn(page, person.email);
    await page.goto('/');
    const links = await menuLinks(page);
    expect(links.length, `${person.email} has a menu`).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const link of links) {
      await page.goto(link);
      try {
        await expectNoError(page, link);
      } catch (e) {
        broken.push((e as Error).message.split('\n')[0]);
      }
    }
    expect([...broken, ...failures], `pages that failed for ${person.email}`).toEqual([]);
  });
}
