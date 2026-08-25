// Word timings -> caption chunks.
//
// TikTok captions are read, not watched. The pattern that works is 3-4 words
// on screen at once with the currently-spoken word highlighted, swapping in
// hard cuts. One-word-at-a-time is trendy but tanks comprehension; whole
// sentences are unreadable at speed.

const MAX_WORDS = 4;
const MAX_SECONDS = 1.7;

/** Group [{word,start,end}] into readable chunks that break on punctuation. */
export function chunkWords(words, { maxWords = MAX_WORDS, maxSeconds = MAX_SECONDS } = {}) {
  const chunks = [];
  let cur = [];

  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      words: cur,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word).join(" "),
    });
    cur = [];
  };

  for (const w of words) {
    cur.push(w);
    const span = w.end - cur[0].start;
    const endsClause = /[.,!?;:]$/.test(w.word.trim());
    if (cur.length >= maxWords || span >= maxSeconds || (endsClause && cur.length >= 2)) {
      flush();
    }
  }
  flush();
  return chunks;
}

/**
 * Fallback when there are no real word timings (no API key, or transcription
 * failed): distribute the beat's own words evenly across its duration. Less
 * accurate than Whisper but keeps the video shippable rather than caption-less.
 */
export function evenChunks(text, durationSeconds, opts = {}) {
  const tokens = String(text || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const per = durationSeconds / tokens.length;
  const words = tokens.map((word, i) => ({
    word,
    start: i * per,
    end: (i + 1) * per,
  }));
  return chunkWords(words, opts);
}


/**
 * Re-align Whisper's word timings onto the words we actually wrote.
 *
 * Whisper splits words it doesn't hold as single tokens — "doomscrolling" comes
 * back as "doom" + "scrolling" — and the chunker then happily breaks a caption
 * mid-word ("I WASTED HOURS DOOM" / "SCROLLING AGAIN TODAY"). Since we know the
 * exact script, we can lay Whisper's timings onto a character timeline and cut
 * it at the real word boundaries instead. This fixes splits AND merges.
 *
 * Returns null when the transcript genuinely disagrees with the script (a
 * misheard word, or numbers spoken differently), so the caller can fall back.
 */
export function alignToScript(words, text) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9']/g, "");

  // Character-level timeline, interpolating within each Whisper token.
  let stream = "";
  const times = [];
  for (const w of words) {
    const n = norm(w.word);
    if (!n) continue;
    const per = (w.end - w.start) / n.length;
    for (let i = 0; i < n.length; i++) {
      stream += n[i];
      times.push([w.start + i * per, w.start + (i + 1) * per]);
    }
  }

  const truth = String(text).split(/\s+/).filter(Boolean);
  const truthNorm = truth.map(norm);
  if (truthNorm.join("") !== stream) return null;

  const out = [];
  let pos = 0;
  for (let i = 0; i < truth.length; i++) {
    const len = truthNorm[i].length;
    if (!len) continue;
    out.push({ word: truth[i], start: times[pos][0], end: times[pos + len - 1][1] });
    pos += len;
  }
  return out.length ? out : null;
}

/** Which word inside a chunk is being spoken at time t (seconds). */
export function activeWordIndex(chunk, t) {
  for (let i = 0; i < chunk.words.length; i++) {
    if (t < chunk.words[i].end) return i;
  }
  return chunk.words.length - 1;
}
