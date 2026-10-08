import { DOCUMENT_FONTS, ResolvedBranding } from '../../domain';

/**
 * How a layout applies resolved branding to its sheet: CSS custom properties
 * and a font stack, never injected styles. Humo's own look leaves everything
 * as document-sheet.scss sets it, so the Standard templates render unchanged.
 */
export interface SheetStyle {
  primary: string | null;
  accent: string | null;
  font: string | null;
}

export function sheetStyle(b: ResolvedBranding): SheetStyle {
  if (b.source === 'humo') return { primary: null, accent: null, font: null };
  return { primary: b.palette.primary, accent: b.palette.accent, font: b.font === 'dm-sans' ? null : DOCUMENT_FONTS[b.font].stack };
}

/** "Thursday 24 October 2026" and "18:00", as printed on notices and minutes. */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
}
