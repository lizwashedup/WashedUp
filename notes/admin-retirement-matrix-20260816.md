# Admin retirement matrix, 2026-08-16

## Decision already made

`washedup-world` is the canonical admin tool. `command-center-next` is a retirement dependency only. This private matrix does not shut down either app or change any live route.

## Headquarters data paths

| Data | Old browser path | Canonical path | Private status |
| --- | --- | --- | --- |
| investors | `command-center-next/app/investors/page.tsx` reads the table directly | `washedup-world/src/app/investors/page.tsx` calls `/api/investors` | Ported through a protected server route |
| growth cards | `command-center-next/app/growth/page.tsx` reads the table directly | `washedup-world/src/app/growth/page.tsx` calls `/api/growth` | Ported through a protected server route |
| tools | `command-center-next/app/systems/page.tsx` reads the table directly | `washedup-world/src/app/systems/page.tsx` calls `/api/tools` | Ported through a protected server route |
| documents | `command-center-next/app/docs/page.tsx` reads the table directly | `washedup-world/src/app/docs/page.tsx` calls `/api/docs` | Ported through a protected server route |
| strategy answers | `command-center-next/app/strategy/page.tsx` reads the table directly | `washedup-world/src/app/strategy/page.tsx` calls `/api/strategy` | Ported through a protected server route |
| quick captures | `command-center-next/app/page.tsx` reads the table directly | `washedup-world/src/app/capture` and `/api/capture` are present as user-owned work in progress | Do not alter until that parallel work is finished |
| content cards | `command-center-next/app/content/page.tsx` reads the table directly | `washedup-world/src/app/api/content-cards` provides protected collection and item routes | Server boundary ported, internal page parity remains open |

## Private safety proof

`washedup-world/src/lib/headquarters-security.test.ts` fails if a browser module imports a Supabase client or directly reads any of the seven Headquarters tables. It also checks that the server database client uses only the service credential and that the middleware protects every non-login API route.

## Remaining retirement gates

1. Complete internal page parity for `content_cards`, or archive the old page after confirming the protected route is sufficient.
2. Let the existing quick-capture work finish and pass the same server-route boundary.
3. Verify route parity and export any data Liz needs before shutdown.
4. Ask separately before any live shutdown, redirect, environment removal, commit, push, or deploy.
