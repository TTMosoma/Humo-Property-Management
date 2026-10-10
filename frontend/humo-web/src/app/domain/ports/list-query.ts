/**
 * How a screen asks for a long list, and what comes back. Lists that grow with
 * the customer (audit events, platform customers, receipts, jobs, people,
 * units) use this shape, so server-side paging, search and sort can arrive
 * without changing the contract.
 *
 * Today screens ask without a page size and get everything (the in-memory
 * adapters hold it all anyway), then filter in the browser. When a list
 * outgrows that, the screen passes its URL state (`urlState`) through as the
 * query and renders `total` and the page it was given.
 */
export interface ListQuery {
  /** Free-text search, as typed. */
  q?: string;
  /** Named filters, e.g. { status: 'unallocated', scheme: 'kingfisher-court' }. Values match the URL state. */
  filters?: Record<string, string | null | undefined>;
  /** e.g. 'receivedAt' or '-receivedAt' (descending). */
  sort?: string;
  /** 1-based. */
  page?: number;
  /** Omit for "everything" (only while lists are small). */
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  /** Matching items across all pages. */
  total: number;
  page: number;
  pageSize: number;
}
