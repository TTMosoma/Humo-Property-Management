import { ExpiryState, LibraryDocument, expiryState } from '../../domain';
import { formatDate } from '../../ui/format/money';
import { Tone } from '../../ui/status-pill/status-pill';

export const EXPIRY_TONE: Record<ExpiryState, Tone> = { none: 'neutral', valid: 'success', expiring: 'warning', expired: 'danger' };

/** "Expires 12 Nov 2026" · "Expired 3 Oct 2026" · null when it doesn't expire. */
export function expiryLabel(d: LibraryDocument): { label: string; tone: Tone } | null {
  const st = expiryState(d);
  if (st === 'none') return null;
  return { label: `${st === 'expired' ? 'Expired' : 'Expires'} ${formatDate(d.expiresAt!)}`, tone: EXPIRY_TONE[st] };
}

export function fileIcon(d: Pick<LibraryDocument, 'mimeType' | 'fileName'>): string {
  if (d.mimeType.startsWith('image/')) return 'image-outline';
  if (/\.(xls|xlsx|csv)$/i.test(d.fileName)) return 'grid-outline';
  return 'document-text-outline';
}
