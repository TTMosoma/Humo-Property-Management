import { ResidentConversation } from '../../domain';

type Message = ResidentConversation['messages'][number];

const WEEKDAY = new Intl.DateTimeFormat('en-ZA', { weekday: 'long' });
const MONTH = new Intl.DateTimeFormat('en-ZA', { month: 'long' });
const DATE = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

/** A conversation's messages by day, oldest first: "Today", "Yesterday", "Monday, 3 November", or with the year when it isn't this one. */
export function byDay(messages: Message[], now = new Date()): { label: string; messages: Message[] }[] {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = start(now);
  const days: { key: number; label: string; messages: Message[] }[] = [];
  for (const m of [...messages].sort((a, b) => a.at.localeCompare(b.at))) {
    const at = new Date(m.at);
    const key = start(at);
    let day = days.at(-1);
    if (day?.key !== key) {
      const diff = Math.round((today - key) / 86_400_000);
      const label = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : at.getFullYear() === now.getFullYear() ? `${WEEKDAY.format(at)}, ${at.getDate()} ${MONTH.format(at)}` : DATE.format(at);
      day = { key, label, messages: [] };
      days.push(day);
    }
    day.messages.push(m);
  }
  return days.map(({ label, messages: list }) => ({ label, messages: list }));
}
