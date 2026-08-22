# Visual parity fixtures

Backs the `visualParity` field in `qa/requirements.json` (see the
`visualParityContract` block at the top of that file for the state
definitions). This folder holds the actual screenshots; the JSON file only
tracks which requirements are tracked and whether they've been checked.

## Convention

One folder per requirement id that carries a `visualParity` field:

```
qa/fixtures/<requirement-id>/
  native.png     # screenshot of the native (Expo) screen
  web.png        # screenshot of the same screen in washedup-web
  parity.json    # what was captured, and the reviewer's verdict
```

`parity.json` shape:

```json
{
  "requirement": "R14",
  "title": "Native Scene feed parity",
  "nativeRoute": "app/(tabs)/explore/index.tsx -> SceneDiscovery",
  "webRoute": "washedup-web: src/app/app/scene/page.tsx",
  "viewport": { "width": 390, "height": 844 },
  "captured": false,
  "notes": "free text — what to look for, known acceptable differences, etc."
}
```

## Workflow

1. Capture `native.png` and `web.png` for the requirement's screen at the
   viewport in `parity.json`.
2. Set `captured: true` and write the reviewer's verdict into `notes`.
3. Flip that requirement's `visualParity` to `"verified"` in
   `qa/requirements.json` and add both PNG paths to its
   `visualParityEvidence` array — `qa/check-traceability.cjs` will then
   enforce that both files actually exist and fail the build if either goes
   missing later.
4. If a requirement never gets a real second-platform counterpart, set its
   `visualParity` to `"not_applicable"` instead of leaving it unverified
   forever.

## Getting the screenshots

Native has no headless render path confirmed yet (Expo web mode is
available — `npm run web` / `expo start --web`, and `react-dom` +
`react-native-web` are already dependencies — but nothing here has proven a
Playwright screenshot against it works end to end). washedup-web is a
standard Next.js app and screenshots normally. This is the open item
flagged elsewhere as "headless rendering feasibility" — resolve that first,
then populate these folders for real.
