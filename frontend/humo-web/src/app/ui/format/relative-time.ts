const TIME = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' });

/** "08:42" today, "Yesterday", otherwise "4 Oct". */
export function relativeTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (d.getTime() >= startOfToday) return TIME.format(d);
  if (d.getTime() >= startOfToday - dayMs) return 'Yesterday';
  return DAY.format(d);
}
