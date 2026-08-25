// Offline sample used by `npm run studio` and as a render smoke test.
// Timings here are hand-set; the pipeline replaces them with real TTS timings.
import { evenChunks } from "./captions.js";

const beat = (say, onscreen, kind, extra = {}) => {
  const seconds = Math.max(1.6, say.split(/\s+/).length / 2.8);
  return {
    say,
    onscreen,
    kind,
    frames: Math.round(seconds * 30) + 10,
    chunks: evenChunks(say, seconds),
    ...extra,
  };
};

export default {
  beats: [
    beat("Your phone doesn't care that you have a deadline.", "It doesn't care", "statement"),
    beat("So I stopped asking it nicely and locked the apps instead.", "Locked", "statement"),
    beat("Finish a real task, take a photo, the AI checks it's actually done.", "Prove it", "ui", { ui: "tasks" }),
    beat("Only then do you get minutes back.", "Then you earn", "ui", { ui: "earn" }),
    beat("Drift. Ninety-nine cents a month after a three day free trial, iPhone only.", "Earn your scroll", "statement"),
  ],
  audioBase: "audio/sample",
};
