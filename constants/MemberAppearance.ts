import { AfterglowFallbackFonts, type AfterglowFontFamilies } from './Typography';

/** September 16 founder direction: retain the live member presentation.
 * This switch controls appearance only, never community structure or access.
 * The rejected candidate remains preserved for provenance, not enabled.
 */
export const MEMBER_REDESIGN_APPEARANCE_ENABLED: boolean = false;

export function memberPresentationFonts(fonts: AfterglowFontFamilies): AfterglowFontFamilies {
  return MEMBER_REDESIGN_APPEARANCE_ENABLED ? fonts : AfterglowFallbackFonts;
}
