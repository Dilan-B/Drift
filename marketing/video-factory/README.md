# Drift Video Factory

Two things live here:

1. **Autopilot** — an unattended TikTok pipeline: idea → script → voiceover →
   render → **QC gate** → post. `npm run autopilot`
2. **The original brand-film generator** — `node scripts/make-video.mjs`,
   unchanged, for landing pages and App Store previews.

---

## Quick start

```bash
cd marketing/video-factory
cp .env.example .env          # fill in OPENAI_API_KEY at minimum
npm run dry-run               # full pipeline, stops before posting
```

Then, once you're happy with what it produces:

```bash
node scripts/tiktok-auth.mjs  # one-time browser authorisation
npm run autopilot             # for real
```

---

## Read this before expecting public posts

TikTok restricts **every unaudited API client to `SELF_ONLY` (private) posts.**
The upload succeeds, the video lands on your account, and only you can see it.

Making posts public requires submitting your API client for TikTok's audit:
2–4 weeks, multiple rounds, and they want a recorded demo of the posting flow
plus a privacy-policy URL. Until that clears, `TIKTOK_PRIVACY_LEVEL` stays
`SELF_ONLY` — and the pipeline reads the permitted list back from TikTok and
follows it regardless of what the env var says, so it can't be fooled into
thinking a post went public when it didn't.

Treat that window as the burn-in period: the loop runs for real, you see
exactly what it would have published, and you flip one env var afterwards.

If you'd rather have a human beat in the loop permanently, set
`TIKTOK_POST_MODE=inbox` — videos land in your TikTok drafts and you tap post.

---

## The QC gate

This is the part that matters. Nothing here has a human looking at a video
before it posts, so `scripts/lib/qc.mjs` is the only thing protecting the
account. **It fails closed** — anything it can't verify is treated as a failure.

**Hard checks** (no model, absolute):

| Check | Blocks on |
|---|---|
| `dimensions` / `codec` | not 1080×1920 H.264 |
| `duration` | outside 8–60s |
| `audio-track` | no audio stream at all |
| `audio-content` | >30% of the video is silent (voiceover silently failed) |
| `voice-quality` | the macOS `say` fallback voice — never publishable |
| `claims` | any banned factual claim (see below) |
| `captions` | a beat with no captions — unwatchable muted |

**Visual review**: six frames are sampled and scored 1–5 by a vision model on
`legibility`, `safe_area`, `polish`, `native` and `hook`. Any dimension below 4,
or any blocking issue it raises, fails the run.

**On failure** the reasons are fed back as constraints and the script is
rewritten — up to `--max-attempts` (default 3), then it gives up loudly rather
than shipping something mediocre.

### Claim linting

`scripts/lib/brand.mjs` is the single source of truth for every factual claim a
video may make. It exists because a batch of scripts in this repo shipped
**"Free on the App Store"** months after the app went paid.

When a fact changes, change it *there* and every future video follows. The
linter currently blocks: calling the app free (only "3-day free trial" is
allowed), any price other than $0.99/month, implying Android, unverifiable
superlatives, medical claims, fake urgency, and named-competitor comparisons.

---

## Footage

Drop clips in and they're picked up automatically — a vision model describes
each new one once and caches it, so the script writer knows what it has.

- `public/capture/` — real app screen recordings. **Highest quality-to-effort
  ratio by far.** Screen-record the shield blocking an app, a task completing,
  the timer running.
- `public/broll/` — live-action or AI-generated clips.

To record the simulator directly:

```bash
node -e "import('./scripts/lib/capture.mjs').then(m=>m.recordSimulator(12,'shield-block.mp4'))"
```

Drive the app however you like while it records. Needs a booted simulator with
a Drift dev build (Screen Time doesn't work in Expo Go).

With no footage at all the pipeline still runs, using rendered UI mocks and
typographic statement cards.

---

## The look

`src/Native.jsx` is deliberately **not** the brand-film aesthetic. The rules it
encodes are the ones that decide whether a vertical video survives the first
second of a For You feed:

- **Hook legible on frame 0** — no fade-in.
- **Karaoke captions**, 3–4 words at a time, active word in mint. Heavy black
  stroke behind white fill so they hold up over any footage.
- **Hard cuts**, never crossfades — fades read as "advert".
- **Motion in every shot** — a slow push-in on otherwise static frames.
- **Safe area enforced.** TikTok's own UI covers the top 250px, bottom 480px,
  left 60px and right 260px of a 1080×1920 frame. `src/safeArea.js` is the
  single source of truth, imported by both the renderer and the QC gate so
  they can't disagree.

The old calm/serif/off-white composition still exists as `DriftPromo`.

---

## Commands

```bash
npm run dry-run                              # everything except posting
npm run autopilot                            # full run
node scripts/autopilot.mjs --count 3         # a batch
node scripts/autopilot.mjs --seed "back to school"
node scripts/autopilot.mjs --script content/test-native.json   # skip the AI stages
npm run studio                               # live-edit the visuals
```

Flags: `--count` `--seed` `--script` `--dry-run` `--no-post` `--max-attempts`
`--voice` `--keep`

## Scheduling

Nothing here schedules itself. To post three times a week:

```
0 16 * * 1,3,5 /usr/local/bin/node scripts/autopilot.mjs >> autopilot.log 2>&1
```

Check `node -v`'s path first — cron gets a minimal PATH.

## Idea memory

`content/state/history.json` records every video made. New ideas are rejected
if they repeat a previous hook exactly *or* share 60% of its words, because the
real long-run failure mode isn't one bad video — it's the same video with new
words for six weeks.

## Layout

```
scripts/
  autopilot.mjs        orchestrator
  tiktok-auth.mjs      one-time OAuth
  make-video.mjs       original brand-film CLI
  lib/
    brand.mjs          facts + claim linter   <- edit when a fact changes
    ideas.mjs          idea generation + dedupe history
    script.mjs         TikTok-native script writer + validation
    tts.mjs            voiceover + word timings
    qc.mjs             the gate
    tiktok.mjs         Content Posting API
    capture.mjs        footage intake + simulator recording
    media.mjs          ffmpeg/ffprobe (Remotion's bundled build)
    openai.mjs         shared model client
src/
  Native.jsx           TikTok-native composition
  Promo.jsx            original brand-film composition
  captions.js          word timings -> caption chunks
  safeArea.js          TikTok chrome geometry
```
