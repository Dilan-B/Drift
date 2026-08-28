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
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  delayRender,
  continueRender,
} from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { fitTextOnNLines } from "@remotion/layout-utils";
import { C, FF } from "./theme.js";
import { BOX, BOX_W, CTA_PILL_Y, SAFE, UI_TEXT_Y } from "./safeArea.js";

// Mirrors FACTS.appStoreSearch — "Drift" alone does not find the app.
const APP_STORE_SEARCH = "Drift Productivity";
import { TasksVisual, EarnVisual, Sprout } from "./Promo.jsx";

const anton = loadAnton();

// Text measurement is only correct once the real font is available. Without
// this, fitTextOnNLines measures against a fallback face (or throws), autoFit
// silently keeps the design size, and a line that should have shrunk to fit two
// rows renders as three — overrunning whatever sits below it.
const fontHandle = delayRender("Loading Anton");
anton.waitUntilDone().then(
  () => continueRender(fontHandle),
  () => continueRender(fontHandle)
);

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
    // Measurement unavailable: keep the design size.
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

// A screenshot shown inside a device body.
//
// The phone is deliberately oversized and runs off the bottom of the frame:
// TikTok's chrome covers the lower ~480px anyway, and what it covers here is
// just the bottom of the handset, where there is nothing to read. That buys a
// much larger, legible screen than fitting the whole device inside the safe
// area would.
const PhoneFrame = ({ src, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const drift = usePushIn(frames, 1.0, 1.03);

  const W = 620;                      // screen width
  const H = Math.round(W * (2622 / 1206));  // keep the source aspect exactly
  const BEZEL = 14;

  return (
    <AbsoluteFill style={{ backgroundColor: C.paper, overflow: "hidden" }}>
      <Sprout size={980} opacity={0.06} style={{ right: -260, top: -160 }} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 560,
          transform: `translateX(-50%) translateY(${(1 - rise) * 90}px) scale(${drift})`,
          transformOrigin: "center top",
          opacity: rise,
        }}
      >
        <div
          style={{
            width: W + BEZEL * 2,
            height: H + BEZEL * 2,
            padding: BEZEL,
            borderRadius: 78,
            background: "linear-gradient(160deg, #3A3D42 0%, #17191C 40%, #26292E 100%)",
            boxShadow: "0 40px 90px rgba(26,40,32,0.34), 0 4px 12px rgba(26,40,32,0.18)",
            boxSizing: "border-box",
          }}
        >
          <div style={{ width: W, height: H, borderRadius: 64, overflow: "hidden", position: "relative", backgroundColor: "#000" }}>
            {/* Screenshots vary — some include the status bar, some are cropped —
                so fill the screen and anchor to the top rather than assuming an
                exact aspect. Any excess is trimmed off the bottom, where the tab
                bar sits, rather than off the content. */}
            <Img
              src={staticFile(`shots/${src}`)}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// These mocks were authored for the brand-film layout, where they sat low in
// an otherwise empty frame. Here the lower third belongs to the text line, so
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

/** The big scroll-stopper line. Used on the hook, statements and the CTA. */
const Onscreen = ({ text, size = 118, top, onLight = false, maxLines = 3 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fitted = autoFit(text, size, maxLines, BOX_W - (onLight ? 60 : 0));
  // No fade-in on frame 0 — the hook has to be legible before it animates.
  const s = spring({ frame, fps, config: { damping: 18, mass: 0.6 } });
  const scale = 0.96 + s * 0.04;
  return (
    <div
      style={{
        position: "absolute",
        left: BOX.x0,
        width: BOX_W,
        top,
        display: "flex",
        justifyContent: "center",
        transform: `scale(${scale})`,
        transformOrigin: "center top",
      }}
    >
      <div
        style={{
          textAlign: "center",
          padding: onLight ? "20px 32px" : 0,
          borderRadius: 28,
          backgroundColor: onLight ? "rgba(10,20,14,0.86)" : "transparent",
          ...punchText(fitted),
        }}
      >
        {text}
      </div>
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
        top: CTA_PILL_Y,
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
          // Fitted, not fixed: a longer label must shrink rather than overrun.
          fontSize: autoFit(label, 44, 1, BOX_W - 120),
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
  const isLight = beat.kind === "ui" || beat.kind === "phone";
  // With subtitles gone this line is the ONLY text, so every beat gets one.
  // UI mocks occupy roughly y470-1000, so on those beats the line sits below
  // them instead of on top, in the band that used to hold the subtitles.
  // A phone beat fills the frame from y560 down, so its line sits above the
  // device. The cream UI mocks instead leave the lower band free, so their
  // line goes underneath them.
  const textTop = beat.kind === "phone" ? BOX.y0 + 20 : isLight ? UI_TEXT_Y : BOX.y0 + 60;

  let bg;
  if (beat.kind === "phone") bg = <PhoneFrame src={beat.src} frames={frames} />;
  else if (beat.kind === "capture" || beat.kind === "broll") bg = <VideoBg src={beat.src} frames={frames} />;
  else if (beat.kind === "ui") bg = <UiBg ui={beat.ui} frames={frames} />;
  else bg = <StatementBg index={statementIndex} frames={frames} />;

  return (
    <AbsoluteFill>
      {bg}
      <Scrim light={isLight} />
      <Wordmark light={isLight} />
      {beat.onscreen ? (
        <Onscreen
          text={beat.onscreen}
          size={index === 0 ? 130 : 112}
          top={textTop}
          onLight={isLight}
          // A ui beat's text sits low, so a third line would run under
          // TikTok's chrome. Top-placed text has the room for three.
          maxLines={isLight || beat.kind === "phone" ? 2 : 3}
        />
      ) : null}
      {isLast ? <CtaPill label={beat.ctaLabel || `Search "${APP_STORE_SEARCH}"`} /> : null}
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
