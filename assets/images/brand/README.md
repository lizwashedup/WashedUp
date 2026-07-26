# Brand mark assets (first-join surfaces)

Source of truth: `WashedUp_HQ/Branding/washedup_branding_2026_PNG_T/16.png`,
the official transparent export of the terracotta W-over-waves mark (the same
art as `washedup_branding_2026_SVG/App Icon.svg`).

- `washedup-waves.png`: the three-wave element under the W, cropped
  pixel-exact from the official export (no redraw). Used as the imageless
  plan-card block on first-join cards.
- `washedup-mark.png`: the full W-over-waves mark, cropped pixel-exact from
  the same export. Used in the first-join empty state.

Why PNG and not the branding SVGs: in the 2026 branding SVG exports the mark
art (W body + waves) is raster texture embedded as base64 `<image>` inside
luminance masks with `feColorMatrix` filters; only the wordmark letters are
true vector paths. React Native cannot render those constructs, and no
standalone vector wave paths exist in the export. The PNG_T files are the
same real art, so crops from them are the brand's pixels, not approximations.
If a clean vector waves file ever ships in a branding update, swap these.
