/**
 * A job reference however it's typed: "MR-1022", "mr1022", "MR 1022" or "1022" all give "1022". Anything else gives null.
 * A reference always finds its job in every scheme the person can see, whatever scheme they're viewing.
 */
export function jobReference(query: string): string | null {
  const m = /^\s*(?:mr)?[\s-]*(\d{3,})\s*$/i.exec(query);
  return m ? m[1] : null;
}

/** Whether a job's reference or words match what was typed (references compared without "MR", spaces or dashes). */
export function matchesJob(job: { ref: string; title: string; location: string }, query: string): boolean {
  const ref = jobReference(query);
  if (ref) return job.ref.replace(/\D/g, '').includes(ref);
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = `${job.ref} ${job.title} ${job.location}`.toLowerCase();
  return terms.length > 0 && terms.every((t) => text.includes(t));
}
