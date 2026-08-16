# Handoff prompt — Drift website blog section

Paste everything below the line into Claude in the driftproductivity.com repo.

---

You're working on the marketing site for **Drift**, an iOS app that blocks your
distracting apps until you earn screen time by completing real tasks. The site is
live at https://driftproductivity.com (Apache-hosted, title "Drift - Stop Mindless
Scrolling"). Match the site's existing design system, components, and build setup —
everything below is content and SEO direction, not design direction.

## Task

Add a **blog section** to the site: an index page plus three posts, wired into the
site's nav and footer.

### Reference drafts

Working drafts of all three posts already exist on a secondary GitHub Pages site.
Fetch them and adapt the copy into our own templates and design system — do not
copy their CSS:

- https://dilan-b.github.io/Drift/blog.html (index)
- https://dilan-b.github.io/Drift/siri-screen-time.html
- https://dilan-b.github.io/Drift/ai-screen-time.html
- https://dilan-b.github.io/Drift/reduce-screen-time.html

Treat these as drafts, not gospel — improve the copy where you can, and apply the
corrections in "Accuracy requirements" below, which the drafts get wrong.

### Posts

1. **"Control Your Screen Time With Siri"** — Apple's built-in Screen Time has no
   Siri interface at all. Drift exposes four actions to Siri via Apple's App Intents
   framework (the successor to the now-deprecated SiriKit), so you can check your
   balance, create a task, start a focus session, or hear today's progress by voice.
   No permission prompt, no shortcut setup. The actions also appear in the Shortcuts
   app for automations (arrive at library → start session; 8am → read balance).
   Be explicit that Siri *cannot* grant screen time or unlock apps — that always
   requires completing a verified task, by design.
   Target queries: "siri screen time", "control screen time with siri",
   "siri shortcuts screen time", "app intents apps".

2. **"AI-Powered Screen Time Control That Actually Works"** — every other screen time
   app trusts you when you say you did the work; Drift checks. Text tasks get
   follow-up questions a pretender can't answer, and tasks can require photo proof.
   Include a comparison table vs Apple Screen Time (override behavior, verification,
   motivation model, Siri support). Note Drift is built on Apple's own Screen Time
   APIs (FamilyControls + ManagedSettings + DeviceActivity), so blocking is enforced
   at the system level and keeps working when the app is force-quit.
   Target queries: "AI screen time app", "best AI screen time app iphone",
   "Apple Intelligence apps".

3. **"How to Actually Reduce Screen Time"** — why willpower-based limits fail and why
   an earning model works instead. Mostly evergreen; port largely as-is.
   Target queries: "how to reduce screen time", "reduce screen time".

### Technical SEO — the site is currently missing all of this

- **`/sitemap.xml`** — currently 404s. Create it covering every page including the
  new blog URLs.
- **`/robots.txt`** — currently 404s. Create it, pointing at the sitemap.
- **Canonical tags** — every page, absolute, on `https://driftproductivity.com`.
- **JSON-LD structured data:**
  - `MobileApplication` on the homepage (iOS, ProductivityApplication, price 0 USD,
    plus a `featureList`).
  - `Article` on each post.
  - `FAQPage` on the Siri and AI posts — Google requires the Q&A text to also be
    **visible on the page**, so render a real FAQ section that matches the schema
    word for word. Good questions: "Can Siri turn off Screen Time?", "What is the
    best AI screen time app for iPhone?", "How is Drift different from Apple Screen
    Time?", "Does Drift work when the app is closed?", "Is Drift free?"
- **Internal linking** — blog index links to all posts; each post links back to the
  index and to one or two sibling posts; homepage and footer link to the blog.
- **Meta** — unique title + description per page, plus `og:title` / `og:description`.

## Accuracy requirements — please don't skip these

- **Check every App Store link on the site.** Two wrong IDs were in circulation
  (`6738963592` and `6746262733`) — both 404. The correct App Store ID is
  **`6778215875`**, verified against the app's real bundle id (`com.sanghani.drift`)
  via the iTunes lookup API. Canonical link:
  `https://apps.apple.com/us/app/drift-productivity/id6778215875`
  (Apple resolves on the numeric ID, so the slug in the path doesn't matter.)
  Audit this everywhere it appears on the site, not just in the new pages.

- **Siri support has not shipped yet.** The App Intents code is written and committed
  but is not in any released build, and the voice commands have not yet been verified
  on a device. Build the Siri post, but **do not publish it** until someone confirms
  the commands actually work on a shipped build. If you need to publish sooner, set
  it `noindex` or hold it as a draft.

- Drift's AI verification runs **server-side**, not on-device, and does not use Apple
  Intelligence / Foundation Models. Don't claim otherwise.

- Drift never sees which apps the user selects — Apple's picker returns opaque tokens.
  That's a real privacy point and it's safe to make.

- Drift is free, with no ads and no tracking.

## Two-site situation, worth raising with the team

There's a second public site at https://dilan-b.github.io/Drift/ serving overlapping
Drift content, including the drafts linked above. Two indexed sites competing on the
same keywords will split ranking signal. Recommend consolidating: either redirect the
GitHub Pages site to driftproductivity.com, or add cross-domain canonical tags on it
pointing here. Flag it rather than deciding unilaterally.
