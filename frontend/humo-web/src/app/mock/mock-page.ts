import { ListQuery, Page } from '../domain';

/**
 * The in-memory adapters hold every row, so they only apply paging; search,
 * filters and sort stay in the screens until a list outgrows the browser.
 * The real API applies the whole ListQuery.
 */
export function toPage<T>(items: T[], query?: ListQuery): Page<T> {
  const pageSize = query?.pageSize ?? items.length;
  const page = Math.max(1, query?.page ?? 1);
  const start = query?.pageSize ? (page - 1) * pageSize : 0;
  return { items: query?.pageSize ? items.slice(start, start + pageSize) : items, total: items.length, page, pageSize };
}
