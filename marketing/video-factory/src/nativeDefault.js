// Offline sample used by `npm run studio` and as a render smoke test.
// Timings here are hand-set; the pipeline replaces them with real TTS timings.

const beat = (say, onscreen, kind, extra = {}) => {
  const seconds = Math.max(1.6, say.split(/\s+/).length / 2.8);
  return { say, onscreen, kind, frames: Math.round(seconds * 30) + 10, ...extra };
};

export default {
  beats: [
    beat("Your phone doesn't care that you have a deadline.", "It doesn't care", "statement"),
    beat("So I stopped asking it nicely and locked the apps instead.", "So I locked them", "ui", { ui: "shield" }),
    beat("Finish a real task, take a photo, the AI checks it's actually done.", "Prove it happened", "ui", { ui: "tasks" }),
    beat("Only then do you get minutes back.", "Then you earn", "ui", { ui: "earn" }),
    beat("Drift. On the App Store.", "Earn your scroll", "statement"),
  ],
  audioBase: "audio/sample",
};
