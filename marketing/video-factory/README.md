# Drift Video Factory

On-demand marketing videos: one command turns a brief into a rendered vertical MP4 (1080×1920, 30fps) with animated brand visuals, an AI voiceover, and burned-in captions.

Pipeline: **brief → script (AI or file) → per-scene TTS voiceover → audio-synced timing → Remotion render**.

## Usage

```bash
cd marketing/video-factory

# Offline test run — built-in script, macOS voice (no keys needed)
node scripts/make-video.mjs

# AI mode — writes the script + human-quality voiceover (needs OPENAI_API_KEY)
OPENAI_API_KEY=sk-... node scripts/make-video.mjs --brief "back to school: earn your scroll between classes"

# Your own script (see content/example-brief.json for the shape)
node scripts/make-video.mjs --script content/example-brief.json --name my-ad
```

Keys go in `marketing/video-factory/.env` (gitignored, auto-loaded):

```
OPENAI_API_KEY=sk-...        # script writing + good TTS
ELEVENLABS_API_KEY=...       # optional: best-quality TTS (wins over OpenAI for voice)
```

Voice priority: ElevenLabs → OpenAI → macOS `say`.

Output lands in `out/<name>.mp4`. Resolved scripts (with timing) are saved to `content/<name>.props.json` so you can tweak copy and re-render with:

```bash
npx remotion render src/entry.jsx DriftPromo out/x.mp4 --props=content/<name>.props.json
```

Live-edit the visuals with hot reload: `npm run studio`.

## Flags

- `--brief "<angle>"` — AI writes the script for this angle (requires `OPENAI_API_KEY`)
- `--script <file.json>` — use your own script JSON
- `--name <slug>` — output filename
- `--voice <name>` — ElevenLabs voice ID, OpenAI voice (`nova`, `alloy`, `shimmer`…), or macOS `say` voice (`Samantha`…)
- `--no-audio` — silent render with fixed scene lengths

## Script shape

```json
{
  "title": "my-ad",
  "scenes": [
    { "visual": "hook",   "kicker": "Screen time", "headline": "...", "voiceover": "..." },
    { "visual": "shield", "..." : "apps get locked behind the shield" },
    { "visual": "tasks",  "..." : "task cards check off, +min chips pop" },
    { "visual": "earn",   "..." : "progress ring counts up earned minutes" },
    { "visual": "cta",    "..." : "sprout logo + download pill" }
  ]
}
```

`visual` picks the scene template (`hook`, `shield`, `tasks`, `earn`, `cta`). Scene length auto-syncs to each voiceover clip. Scene templates live in `src/Promo.jsx`; brand tokens in `src/theme.js` (mirrors the app's `theme.js`).

## Extending

- **New scene template**: add a component in `src/Promo.jsx`, register it in `VISUALS`, add its name to `VISUAL_TYPES` in the CLI so the AI can use it.
- **Better voices**: ElevenLabs is already wired in — set `ELEVENLABS_API_KEY` (and optionally `--voice <voice-id>`, default is Rachel).
- **Music**: drop a track in `public/` and add a low-volume `<Audio>` in `Promo.jsx`.
- **AI b-roll**: drop generated clips (Higgsfield/Runway/Sora) into `public/broll/` — the CLI auto-detects them, offers them to the AI scriptwriter as `"visual": "broll"` scenes (with `"src": "<clip>.mp4"`), and renders them full-bleed with a headline overlay. Vertical 1080×1920 clips work best; other sizes are center-cropped.
- **Square/landscape variants**: add more `<Composition>` entries in `src/Root.jsx` with different dimensions.
