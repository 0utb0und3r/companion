# Face Companion

A React + Vite app with an expressive animated face that checks JSON endpoints and speaks the result.

## Run
```
npm install
npm run dev
```
`npm run build` type-checks and builds; `npm run lint` runs oxlint.

## How the face works
- `components/faceModel.ts`: mood presets, mouth poses and mouth geometry. Tweak a mood's numbers to change its look.
- `components/CompanionFace.tsx`: renders the SVG and eases every value toward its target each frame.
- `components/face-companion.css`: colours per mood (`data-mood`). The page background and eyelids share one animated CSS variable, so they always match.

Moods: neutral (mint), happy (yellow, endpoint healthy), curious (blue, unknown status), concerned (orange, request failed), thinking (lavender, while checking), alert (red, endpoint unhealthy).

## Voice
`hooks/useCompanionSpeech.ts` handles playback. Pick the engine in the Voice dropdown:
- Browser voice: instant, lips flap automatically.
- HeadTTS: lips follow real viseme data. Uses the CDN, or `VITE_HEADTTS_API_URL` if set. Falls back to the browser voice on error.
