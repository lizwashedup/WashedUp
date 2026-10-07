# Shared staged message appearance

Main-community, topic/event and Plan/Circle/DM message adapters now use a shared opt-in presentation in `components/chat/chatMessageAppearance.ts`. The development switch remains off by default. This is a local candidate, not a released app or a finished whole-chat redesign.

The accepted Mona family now carries 16/22 message text, sender names, quoted replies, edited/sending metadata, links and mentions. Cream/ink/clay tokens keep incoming and outgoing messages distinct with restrained six-point corners. Incoming main-chat text also uses the available message column instead of being narrowed a second time by nested percentage limits. Avatars, grouping, original links, reply and moderation gestures, media schemas and existing transport remain with their adapters. Own photo captions remain ink on the light page outside the colored bubble.

Independent review caught nested main/topic URL text retaining DM Sans from the original `LinkifiedText` default; the staged link style now supplies the accepted medium font explicitly. No global text or navigation style was changed. Existing special broadcast/intro cards, voice-player internals, link-preview internals and the Plan/Circle/DM composer still need their staged visual pass.

## Evidence

The shared style factory, header, composer and reaction controls were rendered in a local React Native Web presentation fixture using sample messages. This is not the full app screen or a native gesture test. Mona loaded at 375 and 430 points; short/long text, quotations, incoming/outgoing content and draft entry were inspected. Utility targets measured at least 44 points; the pages had no horizontal overflow. The 430 run explicitly checked a 430-point root after removing a narrower fixture cap.

Calculated solid-surface contrast: ink/white 18.37:1; white/clay and clay/white 6.13:1; muted/paper 5.87:1. These values do not claim contrast for every media preview or remaining legacy surface.

Evidence in the design workspace:
- `verification/native-community/375-message-appearance.png`
- `verification/native-community/430-message-appearance.png`
- `verification/native-community/message-appearance-measurements.json`

The surrounding chat package passes 156 existing/focused checks across 15 suites; full TypeScript passes. No test suite is presented as proof of visual quality. Physical-device text scaling, screen reader reading order, keyboard/scroll feel, the remaining special rows and integrated conversation approval are still required.
