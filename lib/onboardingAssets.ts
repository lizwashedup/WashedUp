// Hero image used on the phone-entry welcome screen and the login screen
// background. Sharing the URL here so both screens stay in sync — when this
// is replaced with a bundled asset (per the prior audit's smell #6), only
// this file needs to change.
//
// TODO: replace with a bundled asset under assets/images/. Cold-start auth
// UX should not depend on Unsplash CDN availability.
export const WELCOME_HERO_URI =
  'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=900&q=80';
