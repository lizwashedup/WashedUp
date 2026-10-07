# Shared chat photo experience — September 13, 2026

This package is in the isolated development copy, behind the existing community-chat redesign switch. It is not released or device-approved.

## What changed

The previous main-community and topic/event renderers cropped every photo to 220 × 180 and offered no full-photo action. Plan/Circle/DM conversations had an uncropped thumbnail but only a basic tap-to-dismiss image modal.

The staged paths now share `ChatPhotoAttachment` and `ChatPhotoViewer`:

- Full source aspect ratio, bounded to the available bubble width and 320 points tall; no cropped-out faces or screenshots. Dimension caching is bounded to 200 entries.
- A visible expand affordance, whole-photo loading and retry states, and the original long-press message actions.
- Full-screen viewing, pinch/double-tap zoom, bounded panning, horizontal photo navigation, and explicit 44-point previous/next/zoom/close controls. Captions remain selectable and long captions scroll separately.
- One photo selection per message ID, not per URL. Two messages using the same image remain distinct.
- Already-loaded, already-visible message photos only. This does not fetch a community album or grant access to additional media. Original media URLs and all sending/storage contracts remain unchanged.
- Selection retires on a room/account change, photo removal, or the existing community/event admission gate closing. An old retry, close, or swipe cannot update a newer image/visit.

The plan/circle shared renderer, persistent community message renderer, and topic/event renderer use the same viewer. Broadcast/intro cards and event-album browsing remain separate existing surfaces. The switch-off paths retain their original image rendering. Bottom navigation and chat business rules are unchanged.

## Research and implementation decision

[Signal’s media guide](https://support.signal.org/hc/en-us/articles/360007317471-View-and-save-media-or-files) supports a clear distinction between viewing an item and browsing a conversation’s broader media collection. The existing event album stays reachable through its original route; this viewer does not pretend the currently loaded messages are a complete archive.

[Expo SDK 54 Image](https://docs.expo.dev/versions/v54.0.0/sdk/image/) documents `contain`, intrinsic load dimensions, recycling keys, and loading/error callbacks. Those match this repository’s installed SDK; the implementation does not depend on a newer SDK’s image APIs.

Reviewed [React Native Awesome Gallery](https://github.com/pavelbabenko/react-native-awesome-gallery) and [React Native Zoom Toolkit](https://github.com/Glazzes/react-native-zoom-toolkit) as gesture references. Their documented capabilities help set expectations for zoom/pan/gallery behavior. No library code or dependency was copied or installed. The initial adapter uses the existing Gesture Handler 2.28 and Reanimated 4.1. Native gesture feel must still be compared on real devices before choosing whether to adopt a maintained gallery library.

## Verification and boundaries

Combined photo/control validation: **65 tests in 10 suites passed**, including 14 actual community/topic screen cases, with `--detectOpenHandles` clean. The full no-emit TypeScript check passed. Portrait 375 × 812 and landscape 812 × 375 browser layouts keep the modal and its controls inside the viewport.

The initial focused photo suite covers contain geometry, extreme aspect ratios, failed-load retry, old request callbacks, recycled image identity, room/account retirement, removed photos, cancelled pans, stale swipe callbacks, and zoomed panning. Screen integration tests exercise original main/topic message IDs and menus, duplicate image URLs, excluded welcome/broadcast photos, existing admission gates and legacy rendering.

Independent review found four issues during development: cancelled pan navigation, old image callbacks overwriting retries, panorama error text clipping, and retained selection callbacks affecting newer visits. These were corrected. Actual-screen tests also reproduced and fixed an open topic photo surviving a false/unresolved “say hi” gate.

Browser review uses the real React Native components with sample local images. Opening, zooming, moving to another photo with zoom reset, unavailable-media states, modal focus and mobile 44-point controls are checked there. This is not a full native application session. The browser screenshot compositor did not reliably reflect a temporary viewport override, so phone-width geometry is recorded from the actual DOM rather than represented as a physical-device screenshot.

Still required: iOS/Android pinch-to-pan arbitration, swipe transitions and responsiveness, landscape and large accessibility text, VoiceOver/TalkBack focus return, slow image loading, very long histories, and full native conversation review. The current gallery is bounded to loaded messages; full archive paging, save/share permissions and media-management actions need their own reviewed adapters. Do not call the whole chat redesign complete from this package.
