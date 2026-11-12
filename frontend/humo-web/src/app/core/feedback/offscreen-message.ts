/** What the toast says: the problem itself, and how many more there are. */
export function offscreenMessage(texts: string[]): string {
  const clean = texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 0);
  if (!clean.length) return '';
  const first = clean[0].length > 160 ? `${clean[0].slice(0, 157).trimEnd()}…` : clean[0];
  const more = clean.length - 1;
  return more ? `${first} (and ${more} more ${more === 1 ? 'problem' : 'problems'} on this page)` : first;
}
