/**
 * WashedUp brand colors (.cursorrules)
 * backgroundCreamOriginal: '#f1e4d4' — warmer/darker tone if switching back
 */
const brand = {
  primaryOrange: '#C4652A',
  backgroundCream: '#FFF8F0',
  backgroundCreamOriginal: '#f1e4d4',
  textDark: '#1A1A1A',
  textMedium: '#666666',
  textLight: '#999999',
  cardBackground: '#FFFFFF',
  border: '#E5E5E5',
  successGreen: '#4CAF50',
  errorRed: '#E53935',
} as const;

export default {
  ...brand,
  light: {
    text: brand.textDark,
    background: brand.backgroundCream,
    tint: brand.primaryOrange,
    tabIconDefault: brand.textLight,
    tabIconSelected: brand.primaryOrange,
  },
  dark: {
    text: brand.textDark,
    background: brand.backgroundCream,
    tint: brand.primaryOrange,
    tabIconDefault: brand.textLight,
    tabIconSelected: brand.primaryOrange,
  },
} as const;
