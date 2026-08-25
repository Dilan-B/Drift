// TikTok-native composition.
//
// Deliberately not the brand-film look. The rules encoded here are the ones
// that decide whether a vertical video survives the first second of a For You
// feed: readable text at arm's length, hard cuts (fades read as "advert"),
// motion in every shot, and nothing important under TikTok's own UI chrome.

import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { fitTextOnNLines } from "@remotion/layout-utils";
import { C, FF } from "./theme.js";
import { BOX, BOX_W, CAPTION_Y, SAFE } from "./safeArea.js";
import { TasksVisual, EarnVisual, Sprout } from "./Promo.jsx";
import { activeWordIndex } from "./captions.js";

const anton = loadAnton();

// Bright mint reads on both dark footage and the cream UI mocks. Brand green
// (#2D7A52) is too dark to use as a highlight over video.
const HILITE = "#6EE7A8";

// Text that does not fit gets shrunk rather than clipped. A long compound word
// ("DOOMSCROLLING") at the design size overruns the safe box, and a clipped
// headline is the single most embarrassing thing this can publish.
// Measurement is real (DOM-based) but memoised — it would otherwise run on
// every frame of every beat.
const fitCache = new Map();

const autoFit = (text, designSize, maxLines, withinWidth) => {
  const key = `${text}|${designSize}|${maxLines}|${withinWidth}`;
  if (fitCache.has(key)) return fitCache.get(key);
  let size = designSize;
  try {
    const fitted = fitTextOnNLines({
      text,
      // NOTE: this option is `maxBoxWidth`. `fitText` (single line) calls the
      // same thing `withinWidth`; passing that name here leaves the bound
      // undefined and the binary search runs away to a 2000px font.
      maxBoxWidth: withinWidth,
      maxLines,
      maxFontSize: designSize, // only ever shrink, never inflate
      fontFamily: anton.fontFamily,
      fontWeight: 400,
      letterSpacing: "-0.5px",
      textTransform: "uppercase",
    });
    const n = Math.floor(fitted?.fontSize);
    if (Number.isFinite(n) && n > 0) size = Math.min(designSize, n);
  } catch {
    // Font not ready or measurement unavailable: keep the design size.
  }
  fitCache.set(key, size);
  return size;
};

// Heavy stroke behind the fill is what makes text survive arbitrary footage.
const punchText = (size) => ({
  fontFamily: anton.fontFamily,
  fontWeight: 400,
  fontSize: size,
  lineHeight: 1.04,
  textTransform: "uppercase",
  color: "#FFFFFF",
  WebkitTextStroke: `${Math.max(6, Math.round(size / 11))}px #0A140E`,
  paintOrder: "stroke fill",
  textShadow: "0 8px 28px rgba(0,0,0,0.55)",
  letterSpacing: -0.5,
});

// ── backgrounds ──────────────────────────────────────────────

const STATEMENT_BGS = [
  `linear-gradient(160deg, #14301F 0%, #0A140E 100%)`,
  `linear-gradient(160deg, #1F3A2A 0%, #10221A 100%)`,
  `linear-gradient(160deg, #0F2418 0%, #1B3B28 100%)`,
];

/** Slow push-in. Static shots read as a slideshow; this keeps the frame alive. */
const usePushIn = (frames, from = 1.0, to = 1.08) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [0, frames], [from, to], { extrapolateRight: "clamp" });
};

const VideoBg = ({ src, frames }) => {
  const scale = usePushIn(frames);
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#0A140E" }}>
      <OffthreadVideo
        src={staticFile(src)}
        muted
        loop
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

const StatementBg = ({ index, frames }) => {
  const scale = usePushIn(frames, 1.0, 1.05);
  return (
    <AbsoluteFill
      style={{
        background: STATEMENT_BGS[index % STATEMENT_BGS.length],
        transform: `scale(${scale})`,
      }}
    >
      <Sprout
        size={900}
        opacity={0.1}
        stem="#8FE3B4"
        leafA="#6EE7A8"
        leafB="#A7F3C9"
        style={{ right: -220, bottom: -180 }}
      />
    </AbsoluteFill>
  );
};

// Logo-free shield. The brand-film build renders real TikTok/Instagram/YouTube
// marks here, which is a takedown risk in an advert — doubly so posted ON
// TikTok. Generic tiles carry the same idea with none of the exposure.
const ShieldMock = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const TILES = ["#4A5A52", "#6B5F52", "#3F5A6B", "#5A4A5E", "#6B6152", "#42604F"];
  return (
    <div
      style={{
        position: "absolute",
        top: 470,
        left: 0,
        right: 0,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: 34,
        width: 620,
        margin: "0 auto",
      }}
    >
      {TILES.map((fillColor, i) => {
        const rise = spring({ frame: frame - delay - i * 4, fps, config: { damping: 200 } });
        const lock = spring({ frame: frame - delay - 20 - i * 3, fps, config: { damping: 14 } });
        return (
          <div
            key={i}
            style={{
              width: 176,
              height: 176,
              borderRadius: 40,
              backgroundColor: fillColor,
              opacity: rise * (1 - lock * 0.45),
              transform: `scale(${0.86 + rise * 0.14})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 12px 34px rgba(10,20,14,0.28)",
            }}
          >
            <svg viewBox="0 0 24 24" width={76} height={76} style={{ opacity: lock }}>
              <rect x="4" y="10.5" width="16" height="11" rx="2.6" fill="#FFFFFF" />
              <path
                d="M7.6 10.5V7.8a4.4 4.4 0 0 1 8.8 0v2.7"
                stroke="#FFFFFF"
                strokeWidth="2.6"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
};

// These mocks were authored for the brand-film layout, where they sat low in
// an otherwise empty frame. Here the lower third belongs to the captions, so
// each one is lifted to occupy roughly y 440-1000 instead.
const UI_MOCKS = {
  tasks: { Component: TasksVisual, offsetY: -470 },
  earn: { Component: EarnVisual, offsetY: -500 },
  shield: { Component: ShieldMock, offsetY: 0 }, // already authored for this layout
};

const UiBg = ({ ui, frames }) => {
  const scale = usePushIn(frames, 1.0, 1.04);
  const { Component: Mock, offsetY } = UI_MOCKS[ui] || UI_MOCKS.tasks;
  // delay={0}: the mock gets the whole beat to play. With the component's own
  // default of 16 frames the cards were still off-screen half a second in.
  return (
    <AbsoluteFill style={{ backgroundColor: C.paper, transform: `scale(${scale})` }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${offsetY}px)` }}>
        <Mock delay={0} />
      </div>
    </AbsoluteFill>
  );
};

// Darkens the top and bottom so white text holds up over bright footage.
// On the light UI mocks a full scrim reads as a dirty grey wash, so those
// beats get a gentle top-only pass (enough for the wordmark) and rely on the
// caption plate for contrast instead.
const Scrim = ({ light = false }) => (
  <AbsoluteFill
    style={{
      background: light
        ? "linear-gradient(180deg, rgba(6,14,10,0.34) 0%, rgba(6,14,10,0) 16%)"
        : "linear-gradient(180deg, rgba(6,14,10,0.55) 0%, rgba(6,14,10,0) 22%, rgba(6,14,10,0) 48%, rgba(6,14,10,0.72) 100%)",
    }}
  />
);

// ── text layers ──────────────────────────────────────────────

/** Word-by-word karaoke captions — the thing viewers actually read. */
const Captions = ({ chunks, onLight = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Each beat has a short pad after the voiceover ends. Dropping the caption
  // during it made the text blink out for ~0.2s at every cut, which reads as a
  // glitch — so the final chunk is held until the beat ends.
  const last = chunks[chunks.length - 1];
  const chunk =
    chunks.find((c) => t >= c.start && t < c.end) ?? (t >= last.end ? last : chunks[0]);
  if (!chunk) return null;

  const active = activeWordIndex(chunk, t);
  // Pop on chunk change rather than fade — fades feel like an advert.
  const age = t - chunk.start;
  const pop = spring({ frame: age * fps, fps, config: { damping: 14, mass: 0.5 } });
  const scale = 0.92 + pop * 0.08;

  return (
    // Outer box owns the position; the inner row hugs the text so the plate
    // never stretches into dead space on a short chunk.
    <div
      style={{
        position: "absolute",
        left: BOX.x0,
        width: BOX_W,
        top: CAPTION_Y,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          maxWidth: BOX_W,
          gap: "0 18px",
          padding: onLight ? "18px 30px" : 0,
          borderRadius: 26,
          backgroundColor: onLight ? "rgba(10,20,14,0.86)" : "transparent",
          transform: `scale(${scale})`,
          transformOrigin: "center top",
          ...punchText(autoFit(chunk.text, 74, 2, BOX_W - (onLight ? 60 : 0))),
        }}
      >
        {chunk.words.map((w, i) => (
          <span
            key={i}
            style={{
              color: i === active ? HILITE : "#FFFFFF",
              transform: i === active ? "translateY(-4px)" : "none",
              display: "inline-block",
            }}
          >
            {w.word.replace(/^\s+/, "")}
          </span>
        ))}
      </div>
    </div>
  );
};

/** The big scroll-stopper line. Used on the hook, statements and the CTA. */
const Onscreen = ({ text, size = 118 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fitted = autoFit(text, size, 3, BOX_W);
  // No fade-in on frame 0 — the hook has to be legible before it animates.
  const s = spring({ frame, fps, config: { damping: 18, mass: 0.6 } });
  const scale = 0.96 + s * 0.04;
  return (
    <div
      style={{
        position: "absolute",
        left: BOX.x0,
        width: BOX_W,
        top: BOX.y0 + 60,
        textAlign: "center",
        transform: `scale(${scale})`,
        transformOrigin: "center top",
        ...punchText(fitted),
      }}
    >
      {text}
    </div>
  );
};

const Wordmark = ({ light = false }) => (
  <div
    style={{
      position: "absolute",
      left: BOX.x0,
      top: SAFE.top - 130,
      fontFamily: FF.mark,
      fontWeight: 700,
      fontSize: 34,
      letterSpacing: 8,
      color: light ? "rgba(26,40,32,0.80)" : "rgba(255,255,255,0.82)",
      textShadow: light ? "none" : "0 2px 10px rgba(0,0,0,0.5)",
    }}
  >
    DRIFT
  </div>
);

const CtaPill = ({ label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 8, fps, config: { damping: 16 } });
  return (
    <div
      style={{
        position: "absolute",
        left: BOX.x0,
        width: BOX_W,
        top: CAPTION_Y - 190,
        display: "flex",
        justifyContent: "center",
        opacity: s,
        transform: `scale(${0.9 + s * 0.1})`,
      }}
    >
      <div
        style={{
          backgroundColor: HILITE,
          color: "#0A140E",
          fontFamily: anton.fontFamily,
          fontSize: 44,
          textTransform: "uppercase",
          letterSpacing: 1,
          padding: "26px 54px",
          borderRadius: 999,
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        }}
      >
        {label}
      </div>
    </div>
  );
};

// ── beat ─────────────────────────────────────────────────────

const Beat = ({ beat, index, isLast, audioBase, statementIndex }) => {
  const frames = beat.frames;
  const isLight = beat.kind === "ui";
  // The UI mocks occupy the upper-middle of the frame, exactly where the big
  // line sits — so it is suppressed over them and the captions carry the beat.
  // The script validator also forbids a "ui" CTA, this is the belt-and-braces.
  const showBigText = (index === 0 || beat.kind === "statement" || isLast) && !isLight;

  let bg;
  if (beat.kind === "capture" || beat.kind === "broll") bg = <VideoBg src={beat.src} frames={frames} />;
  else if (beat.kind === "ui") bg = <UiBg ui={beat.ui} frames={frames} />;
  else bg = <StatementBg index={statementIndex} frames={frames} />;

  return (
    <AbsoluteFill>
      {bg}
      <Scrim light={isLight} />
      <Wordmark light={isLight} />
      {showBigText && beat.onscreen ? (
        <Onscreen text={beat.onscreen} size={index === 0 ? 130 : 112} />
      ) : null}
      {isLast ? <CtaPill label={beat.ctaLabel || "Drift on the App Store"} /> : null}
      {beat.chunks?.length ? <Captions chunks={beat.chunks} onLight={isLight} /> : null}
      {beat.audio ? <Audio src={staticFile(`${audioBase}/${beat.audio}`)} /> : null}
    </AbsoluteFill>
  );
};

export const Native = ({ beats = [], audioBase = "audio", music = null, musicVolume = 0.12 }) => {
  let at = 0;
  let statementIndex = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0A140E" }}>
      {music ? <Audio src={staticFile(music)} volume={musicVolume} loop /> : null}
      {beats.map((beat, i) => {
        const from = at;
        at += beat.frames;
        const si = beat.kind === "statement" ? statementIndex++ : statementIndex;
        return (
          <Sequence key={i} from={from} durationInFrames={beat.frames}>
            <Beat
              beat={beat}
              index={i}
              isLast={i === beats.length - 1}
              audioBase={audioBase}
              statementIndex={si}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
