// Fallback script used by Remotion Studio previews and offline runs.
// The make-video CLI overwrites frames/audio at generation time.
export default {
  title: "drift-default-promo",
  scenes: [
    {
      visual: "hook",
      kicker: "Screen time",
      headline: "Your apps cost you nothing. That's the problem.",
      voiceover:
        "Your apps cost you nothing to open. That's exactly why you can't stop.",
      frames: 120,
    },
    {
      visual: "shield",
      kicker: "The shield",
      headline: "Drift locks your distracting apps.",
      voiceover:
        "Drift puts a shield over the apps that eat your day. They stay locked.",
      frames: 120,
    },
    {
      visual: "tasks",
      kicker: "Do real things",
      headline: "Finish tasks. Earn minutes.",
      voiceover:
        "Finish real tasks, and you earn screen time back. Minute by minute.",
      frames: 120,
    },
    {
      visual: "earn",
      kicker: "Earned, not given",
      headline: "Scroll guilt-free.",
      voiceover:
        "So when you scroll, it's time you actually earned. No guilt.",
      frames: 110,
    },
    {
      visual: "cta",
      kicker: "Free on the App Store",
      headline: "Earn your scroll.",
      voiceover: "Drift. Earn your scroll.",
      frames: 110,
    },
  ],
};
