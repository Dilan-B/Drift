# App Store Handoff — Drift 1.1.4

**For:** Riaan (Mac + Xcode + App Store Connect)
**From:** Dilan
**Why:** I'm on Windows, so I can't run the Simulator or build. Everything below is
yours to run. No Claude needed — this is a plain checklist.

There are **two separate jobs** here:

- **Job A — unblock the rejection.** Three code fixes are already written and need a
  build + resubmit. One fix is metadata-only and happens in App Store Connect.
- **Job B — the App Store media.** Screenshots and the preview video, which we've
  never actually made properly.

Job A is what's blocking release. Do it first.

---

# JOB A — Ship the rejection fixes

## A0. Get the code

**Everything is merged to `main` and pushed.** No branch to check out.

```bash
git checkout main
git pull origin main
```

Confirm with `git log --oneline -6`. You should see `7360ba8` (the review fixes),
`fd8eb90` (the merge), and `cd71f3c` (SQL corrections) in the history. If you
don't, stop and message Dilan.

### Already done — do NOT redo these

| | Status |
|---|---|
| The three code fixes | ✅ merged to `main` |
| Supabase SQL (analytics, push tokens, referrals, streaks) | ✅ run against the Drift project |
| `send-push` + `send-scheduled-pushes` edge functions | ✅ deployed |
| App Store description copy (incl. Terms link) | ✅ written, in `marketing/aso-keywords.md` — still needs pasting into App Store Connect |

**Still open:** the `PUSH_SECRET` secret (Dilan holds it), the App Store Connect
metadata edits (A2), and the build + submit (A3).

## A1. What changed and why

Four issues came back from review across three rejection rounds. Here's what each
one was and what was done about it.

### 1. TestFlight users are locked out by "Update Required" — FIXED

**This is also the bug you and Dilan were hitting.** `app.json` said
`"version": "1.0.0"` while the actual shipped build is `1.1.4` (per `MARKETING_VERSION`
in the Xcode project and `CFBundleShortVersionString` in `Info.plist`).

The force-update gate in `Drift.jsx` reads `Constants.expoConfig.version` at runtime —
which comes from `app.json`, **not** from the native build settings. So the app
compared "1.0.0" against whatever's live on the App Store, decided it was ancient,
and hard-blocked behind `ForceUpdateModal` forever. No way past it, by design — that
modal has no dismiss.

Fixed by setting `app.json` and `package.json` to `1.1.4`.

> ⚠️ **This will bite us again.** `app.json`'s version is a *separate* value from the
> Xcode `MARKETING_VERSION`. Every time you bump the version in Xcode, bump it in
> `app.json` too, or the lockout returns. Worth adding to the release checklist.

### 2. Guideline 4.8 — Sign in with Apple missing — FIXED

Apple rejected this twice, including after we replied saying we had it. We were wrong:
`appleSignIn.js` was fully written, but its import in `OnboardingScreen.jsx` was
**commented out** and the button was never rendered. Only Google showed on the auth
screen. Apple's screenshot was correct.

Fixed by uncommenting the import and rendering `<AppleSignInButton>` above the Google
button in `OAuthButtons`.

**Verify this on the Simulator before you submit** — it's the single most likely thing
to get us rejected a fourth time. See A3.

### 3. Guideline 5.6.3 — rating prompt during onboarding — FIXED

`ReviewPromptScreen` fired the moment the onboarding tutorial finished, before the
user had done anything at all. That's precisely what 5.6.3 prohibits.

Now it triggers after the user's **3rd completed task**, once ever, gated behind an
`AsyncStorage` flag (`drift_review_prompt_shown`) so it survives restarts. The
tutorial no longer triggers it at all.

### 4. Guideline 3.1.2 — Terms of Use link — NOT A CODE FIX

This one is metadata and cannot be fixed in the app. See **A2**.

The app still contains dormant RevenueCat/subscription code (`useSubscription.js`),
which is why Apple keeps applying auto-renewable-subscription rules even though the
paywall is disabled. Nothing to remove for this rejection — they're asking for a link
in the **store listing**, not in the app. We already have working Terms/Privacy links
inside the app; their automated scanner doesn't look there.

## A2. Fix the metadata in App Store Connect

Do this in the browser — no build required. It's the one that auto-rejected us last time.

1. App Store Connect → **Drift Productivity** → the **1.1.4** version page
2. In the **Description** field, add this as its own line (put it at the very bottom):
   ```
   Terms of Use: https://driftproductivity.com/terms/
   ```
3. Go to **App Information** → scroll to **License Agreement**. Confirm it's set to
   Apple's **Standard EULA**. If a custom one was ever uploaded, either remove it or
   make sure its link resolves.
4. Confirm the **Privacy Policy URL** field is filled: `https://driftproductivity.com/privacy/`
5. **Before saving, open both URLs in a private window.** If either 404s, the
   automated check fails again and we lose another round-trip. They're served from
   our GitHub Pages site.

## A3. Build, verify, submit

1. Bump the build number in Xcode. Review has already seen `1.1.4 (1)` through
   `1.1.4 (5)`, so go to **6** or higher — `CURRENT_PROJECT_VERSION` in the project
   settings. Leave `MARKETING_VERSION` at `1.1.4`.
2. `npx expo prebuild` if needed, then Archive → Distribute → TestFlight.
3. **Verify on a real install before submitting:**
   - [ ] App opens without the "Update Required" screen ← the bug that started this
   - [ ] Auth screen shows **both** an Apple button and a Google button
   - [ ] Apple sign-in completes and lands you in the app
   - [ ] Finishing onboarding does **not** show the "Help Drift grow" review screen
   - [ ] Completing 3 tasks **does** show it, once
4. In **App Review Information → Notes**, paste:

   > Sign in with Apple is offered as an equivalent login option on the sign-up and
   > sign-in screens, presented above Google. Terms of Use (EULA) is linked in the App
   > Description and in-app on the sign-up screen. The rating prompt has been moved out
   > of onboarding and now appears only after the user completes three tasks.

5. Reply to the open App Review thread with a **screen recording** showing the auth
   screen with the Apple button, and the Terms link in the description. They've asked
   for this twice — attaching it up front is faster than another rejection.
6. Submit.

---

# JOB B — App Store media

We currently have no real screenshots and no preview video. Apple gives us up to
**10 screenshots + 3 videos (≤30s each)** per device size. In practice, **the first
2–3 screenshots are what over 80% of people ever see.**

## B1. Set up the Simulator

Use `capture.command` in this folder — it boots an iPhone 16 Pro Max sim and gives you
a menu for screenshots and recording:

```bash
chmod +x capture.command
./capture.command
```

Everything lands in `./captures/` at native **1290 × 2796** — exactly Apple's 6.9"
requirement, no bezels, no notch artifacts, no cropping needed.

If you'd rather do it by hand:
```bash
xcrun simctl boot "iPhone 16 Pro Max"
open -a Simulator
xcrun simctl io booted screenshot shot.png
xcrun simctl io booted recordVideo --codec h264 clip.mov   # ctrl-C to stop
```

**Use the Simulator, not a physical phone** — unless you have a 6.9" device on hand,
a physical capture won't hit the required resolution and will need upscaling.

## B2. Set the stage first

Do not skip this. Empty states photograph terribly and this is the difference between
screenshots that convert and screenshots that look like a school project.

- Fresh test account
- 3–4 **realistic** tasks queued (`Finish calc problem set`, `Run 2 miles`,
  `Clean room` — not `test`, not `asdf`)
- A streak going (a few days of history)
- Some earned balance on the clock so the timer isn't at zero
- TikTok/Instagram installed on the sim if possible, so the shield screen shows real
  recognizable icons — this is what makes the blocked-apps shot land

## B3. Shot list — stills

Capture each in **both light and dark**. It costs two minutes and means we can swap
later without redoing the session.

| # | Screen | Notes |
|---|--------|-------|
| 1 | Shield / blocked apps | **Dark mode.** Our most dramatic frame — lead with it |
| 2 | Today screen, tasks queued | Shows the core loop at rest |
| 3 | Photo-proof capture, mid-flow | Camera up, task visible |
| 4 | AI-verified checkmark + time earned | The payoff moment |
| 5 | Parent dashboard assigning a task | Family mode |
| 6 | Streak / stats screen | Retention proof |

## B4. Shot list — video clips

Record each as its **own 5–8s take**. Do not do one continuous run-through — separate
clips let you cut and reorder without re-shooting.

1. Shield screen blocking TikTok/Instagram — hold 3s, let it read
2. Tap "+ Add task" → type a real task → save
3. Complete task → camera opens → photo proof → shutter
4. AI verification checkmark landing + the credits/XP popup *(it's only on screen for
   2 seconds — start recording before you trigger it)*
5. Shield clearing, timer counting down, apps tappable again
6. Fast pans: streak counter, family dashboard, stats card

## B5. Cut the video (15–30s)

Structure it as a hook-first ad, not a walkthrough. **It autoplays muted in search
results**, so it has to work with zero sound — bold on-screen text carries it.

| Time | Content | Text overlay |
|------|---------|--------------|
| 0–3s | Shield blocking apps | "Your apps are locked." |
| 3–8s | Add task → photo proof → AI verifies | — |
| 8–13s | Shield unlocks, timer fills | "Earn it back." |
| 13–20s | Montage: streak, family mode, stats | — |
| 20–25s | End card | "Earn your screen time." + icon |

No voiceover needed. CapCut or iMovie is genuinely fine.

**Shoot once, cut three ways** — this same footage is what we need for TikTok, Reddit,
and Product Hunt per `marketing/outreach-targets.md`. Export a vertical crop while
you're in there.

## B6. Build the screenshot frames

Open **`screenshot-studio.html`** (in this folder) in Chrome. It's a self-contained
tool — no install, no server, just double-click it.

- Drag a raw capture onto any frame, or click to browse
- Edit the kicker and headline inline
- Toggle light/dark **per frame to match the screenshot you dropped in** — a dark-mode
  capture on a cream frame looks broken
- **Export all PNGs** writes true 1290 × 2796 files

It uses Drift's real palette and type from `theme.js`, so the frames look like the app
rather than a generic template. Needs an internet connection (it pulls Playfair
Display / Orbitron from Google Fonts). Chrome may ask once to allow multiple downloads.

Headlines are pre-seeded, but change them if you have better ones:

1. "Blocked until you earn it." — *dark*
2. "Do the task. Unlock the app."
3. "AI checks your proof."
4. "Parents assign. Kids earn."
5. "Watch the streak grow."

## B7. Upload order

Order is the highest-leverage decision here. Lead **shield → unlock → family mode**:
tension, then payoff, then breadth. Video goes in the first gallery slot.

---

## Questions

Anything ambiguous, ping Dilan — don't guess on the review-related items, we've already
burned three rounds on this submission.
