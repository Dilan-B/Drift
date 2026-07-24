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
} from "remotion";
import { C, FF } from "./theme.js";

// ── shared bits ──────────────────────────────────────────────

const Kicker = ({ children, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${(1 - s) * 20}px)`,
        fontFamily: FF.body,
        fontWeight: 700,
        fontSize: 30,
        letterSpacing: 8,
        textTransform: "uppercase",
        color: C.sage,
        marginBottom: 36,
      }}
    >
      {children}
    </div>
  );
};

// Word-by-word rise-in Playfair headline
const Headline = ({ text, delay = 6, size = 108, color = C.inkDeep }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  return (
    <div
      style={{
        fontFamily: FF.display,
        fontWeight: 500,
        fontSize: size,
        lineHeight: 1.12,
        color,
        maxWidth: 880,
      }}
    >
      {words.map((w, i) => {
        const s = spring({
          frame: frame - delay - i * 3,
          fps,
          config: { damping: 200 },
        });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: "0.28em",
              opacity: s,
              transform: `translateY(${(1 - s) * 46}px)`,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

// Caption of the voiceover line, pinned low — social videos play muted.
const Caption = ({ text, delay = 10 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 200,
        left: 100,
        right: 100,
        textAlign: "center",
        opacity: s,
        transform: `translateY(${(1 - s) * 24}px)`,
      }}
    >
      <span
        style={{
          fontFamily: FF.body,
          fontWeight: 500,
          fontSize: 38,
          lineHeight: 1.5,
          color: C.inkMid,
          backgroundColor: "rgba(255,255,255,0.85)",
          padding: "14px 28px",
          borderRadius: 20,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {text}
      </span>
    </div>
  );
};

// Low-opacity seedling watermark — the brand motif.
const Sprout = ({ size = 520, opacity = 0.07, style }) => (
  <svg
    viewBox="0 0 100 100"
    width={size}
    height={size}
    style={{ position: "absolute", opacity, ...style }}
  >
    <path
      d="M50 92 C50 70 50 55 50 42"
      stroke={C.deep}
      strokeWidth="4"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M50 46 C36 46 26 38 24 24 C40 24 50 32 50 46 Z"
      fill={C.sage}
    />
    <path
      d="M50 38 C62 38 72 30 74 18 C58 18 50 26 50 38 Z"
      fill={C.terra}
    />
  </svg>
);

const SceneShell = ({ children, bg = C.paper }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 8, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp" }
  );
  const drift = Math.sin((frame / fps) * 0.8) * 6;
  return (
    <AbsoluteFill style={{ backgroundColor: bg, opacity: fadeIn * fadeOut }}>
      <Sprout style={{ right: -120, bottom: -80, transform: `rotate(${8 + drift * 0.4}deg)` }} />
      <div style={{ position: "absolute", top: 90, left: 100, display: "flex", alignItems: "center", gap: 16 }}>
        <svg viewBox="0 0 100 100" width={40} height={40}>
          <path d="M50 92 C50 70 50 55 50 42" stroke={C.deep} strokeWidth="6" strokeLinecap="round" fill="none" />
          <path d="M50 46 C36 46 26 38 24 24 C40 24 50 32 50 46 Z" fill={C.sage} />
          <path d="M50 38 C62 38 72 30 74 18 C58 18 50 26 50 38 Z" fill={C.terra} />
        </svg>
        <span style={{ fontFamily: FF.mark, fontWeight: 700, fontSize: 40, letterSpacing: 6, color: C.inkDeep }}>
          DRIFT
        </span>
      </div>
      {children}
    </AbsoluteFill>
  );
};

const CenterCol = ({ children, top = 420 }) => (
  <div
    style={{
      position: "absolute",
      top,
      left: 100,
      right: 100,
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
    }}
  >
    {children}
  </div>
);

// ── scene visuals ────────────────────────────────────────────

const APPS = [
  { icon: "tiktok.svg", bg: "#010101" },
  {
    icon: "instagram.svg",
    bg: "radial-gradient(circle at 28% 110%, #FDCB52 8%, #FD1D1D 52%, #833AB4 92%)",
  },
  { icon: "youtube.svg", bg: "#FF0000" },
  { icon: "x.svg", bg: "#0A0A0A" },
  { icon: "snapchat.svg", bg: "#FFFC00" },
  { icon: "reddit.svg", bg: "#FF4500" },
];

const ShieldVisual = ({ delay = 18 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        top: 1000,
        left: 140,
        right: 140,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 44,
        justifyItems: "center",
      }}
    >
      {APPS.map((a, i) => {
        const pop = spring({ frame: frame - delay - i * 3, fps, config: { damping: 14 } });
        const lock = spring({ frame: frame - delay - 22 - i * 3, fps, config: { damping: 200 } });
        return (
          <div key={i} style={{ position: "relative", transform: `scale(${pop})` }}>
            <div
              style={{
                width: 190,
                height: 190,
                borderRadius: 44,
                background: a.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                filter: `grayscale(${lock * 0.85})`,
                opacity: 1 - lock * 0.45,
              }}
            >
              <Img
                src={staticFile(`icons/${a.icon}`)}
                style={{ width: 104, height: 104 }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: lock,
                transform: `scale(${0.5 + lock * 0.5})`,
              }}
            >
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 42,
                  backgroundColor: C.deep,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg viewBox="0 0 24 24" width={44} height={44} fill="none" stroke="#F7F7F4" strokeWidth="2.2">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11 V7 a4 4 0 0 1 8 0 v4" />
                </svg>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TASKS = [
  { label: "Finish econ problem set", mins: 20 },
  { label: "30-minute run", mins: 15 },
  { label: "Clean your room", mins: 10 },
];

const TasksVisual = ({ delay = 16 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: "absolute", top: 960, left: 110, right: 110 }}>
      {TASKS.map((t, i) => {
        const rise = spring({ frame: frame - delay - i * 8, fps, config: { damping: 200 } });
        const done = spring({ frame: frame - delay - 26 - i * 12, fps, config: { damping: 12 } });
        const checked = done > 0.05;
        return (
          <div
            key={i}
            style={{
              opacity: rise,
              transform: `translateY(${(1 - rise) * 40}px)`,
              backgroundColor: C.card,
              borderRadius: 32,
              padding: "34px 38px",
              marginBottom: 26,
              display: "flex",
              alignItems: "center",
              gap: 28,
              boxShadow: "0 10px 40px rgba(26,40,32,0.08)",
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: 29,
                border: `3px solid ${checked ? C.terra : C.inkFaint}`,
                backgroundColor: checked ? C.terra : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: `scale(${checked ? 0.9 + done * 0.1 : 1})`,
              }}
            >
              {checked ? (
                <svg viewBox="0 0 24 24" width={34} height={34} fill="none" stroke="#FFFFFF" strokeWidth="3">
                  <path d="M5 13 l4.5 4.5 L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </div>
            <span
              style={{
                flex: 1,
                fontFamily: FF.body,
                fontWeight: 500,
                fontSize: 42,
                color: C.inkDeep,
                textDecoration: checked ? "line-through" : "none",
                textDecorationColor: C.inkFaint,
                opacity: checked ? 0.6 : 1,
              }}
            >
              {t.label}
            </span>
            <span
              style={{
                fontFamily: FF.body,
                fontWeight: 700,
                fontSize: 34,
                color: C.terra,
                backgroundColor: C.terraLo,
                padding: "12px 24px",
                borderRadius: 999,
                opacity: done,
                transform: `scale(${0.6 + done * 0.4})`,
              }}
            >
              +{t.mins} min
            </span>
          </div>
        );
      })}
    </div>
  );
};

const EarnVisual = ({ delay = 14 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 70 });
  const minutes = Math.round(p * 45);
  const R = 240;
  const CIRC = 2 * Math.PI * R;
  return (
    <div
      style={{
        position: "absolute",
        top: 940,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "relative", width: 560, height: 560 }}>
        <svg viewBox="0 0 560 560" width={560} height={560}>
          <circle cx="280" cy="280" r={R} stroke={C.sageLo} strokeWidth="34" fill="none" />
          <circle
            cx="280"
            cy="280"
            r={R}
            stroke={C.terra}
            strokeWidth="34"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - p * 0.75)}
            transform="rotate(-90 280 280)"
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontFamily: FF.display, fontSize: 150, color: C.inkDeep, lineHeight: 1 }}>
            {minutes}
          </span>
          <span
            style={{
              fontFamily: FF.body,
              fontWeight: 700,
              fontSize: 32,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: C.sage,
              marginTop: 12,
            }}
          >
            min earned
          </span>
        </div>
      </div>
    </div>
  );
};

const ChallengeVisual = ({ delay = 14 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  // you race ahead; friend trails
  const youP = interpolate(frame, [delay + 20, delay + 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const friendP = interpolate(frame, [delay + 20, delay + 78], [0, 0.72], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const win = spring({ frame: frame - delay - 82, fps, config: { damping: 12 } });
  const players = [
    { name: "You", initials: "YOU", p: youP, winner: true },
    { name: "Jake", initials: "JK", p: friendP, winner: false },
  ];
  return (
    <div style={{ position: "absolute", top: 920, left: 110, right: 110 }}>
      <div
        style={{
          opacity: rise,
          transform: `translateY(${(1 - rise) * 40}px)`,
          backgroundColor: C.card,
          borderRadius: 40,
          padding: "44px 48px",
          boxShadow: "0 10px 40px rgba(26,40,32,0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: FF.body, fontWeight: 700, fontSize: 44, color: C.inkDeep }}>
            20 push-ups
          </span>
          <span
            style={{
              fontFamily: FF.body,
              fontWeight: 700,
              fontSize: 28,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: C.clay,
              backgroundColor: C.clayLo,
              padding: "12px 24px",
              borderRadius: 999,
            }}
          >
            First done wins
          </span>
        </div>
        {players.map((pl, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <div
              style={{
                width: 86,
                height: 86,
                borderRadius: 43,
                backgroundColor: pl.winner ? C.deep : C.sand,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FF.body,
                fontWeight: 700,
                fontSize: 26,
                color: pl.winner ? "#F7F7F4" : C.inkMid,
              }}
            >
              {pl.initials}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: FF.body,
                  fontWeight: 500,
                  fontSize: 30,
                  color: C.inkMid,
                  marginBottom: 12,
                }}
              >
                {pl.name}
              </div>
              <div style={{ height: 26, borderRadius: 13, backgroundColor: C.sageLo, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${pl.p * 100}%`,
                    height: "100%",
                    borderRadius: 13,
                    backgroundColor: pl.winner ? C.terra : C.inkFaint,
                  }}
                />
              </div>
            </div>
            {pl.winner ? (
              <span
                style={{
                  fontFamily: FF.body,
                  fontWeight: 700,
                  fontSize: 32,
                  color: "#F7F7F4",
                  backgroundColor: C.terra,
                  padding: "14px 26px",
                  borderRadius: 999,
                  opacity: win,
                  transform: `scale(${0.6 + win * 0.4})`,
                }}
              >
                Winner · +20 min
              </span>
            ) : (
              <span
                style={{
                  fontFamily: FF.body,
                  fontWeight: 500,
                  fontSize: 30,
                  color: C.inkFaint,
                  opacity: win,
                }}
              >
                still going…
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Photo-proof card: snapshot gets AI-scanned, then verified with a payout chip.
const ProofVisual = ({ delay = 14 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const scanStart = delay + 18;
  const scanEnd = scanStart + 46;
  const scanY = interpolate(frame, [scanStart, scanEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scanning = frame >= scanStart && frame <= scanEnd;
  const done = spring({ frame: frame - scanEnd - 4, fps, config: { damping: 12 } });
  const W = 640;
  const H = 520;
  return (
    <div
      style={{
        position: "absolute",
        top: 930,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity: rise,
          transform: `translateY(${(1 - rise) * 40}px)`,
          backgroundColor: C.card,
          borderRadius: 40,
          padding: 28,
          boxShadow: "0 10px 40px rgba(26,40,32,0.08)",
        }}
      >
        <div
          style={{
            position: "relative",
            width: W,
            height: H,
            borderRadius: 28,
            overflow: "hidden",
            backgroundColor: "#EDEFE9",
          }}
        >
          {/* flat illustration: tidy desk */}
          <svg viewBox="0 0 640 520" width={W} height={H}>
            <rect x="0" y="0" width="640" height="520" fill="#E9EDE6" />
            <rect x="0" y="330" width="640" height="24" fill={C.bark} opacity="0.55" />
            <rect x="0" y="354" width="640" height="166" fill="#DDE2D8" />
            {/* laptop */}
            <rect x="220" y="200" width="200" height="126" rx="10" fill={C.deep} />
            <rect x="234" y="214" width="172" height="98" rx="6" fill="#9DB8A6" />
            <rect x="196" y="326" width="248" height="12" rx="6" fill="#3A5544" />
            {/* mug */}
            <rect x="480" y="284" width="52" height="46" rx="8" fill={C.clay} />
            <path d="M532 296 q26 10 0 24" stroke={C.clay} strokeWidth="9" fill="none" />
            {/* plant */}
            <rect x="96" y="278" width="56" height="52" rx="10" fill={C.clayLo} />
            <path d="M124 278 C124 250 108 240 96 234 C118 232 128 244 124 262 Z" fill={C.sage} />
            <path d="M124 278 C124 252 140 240 152 236 C132 232 120 246 124 264 Z" fill={C.terra} />
            {/* window light */}
            <rect x="420" y="60" width="150" height="120" rx="12" fill="#F4F6F0" />
          </svg>
          {/* corner brackets */}
          {[
            { top: 18, left: 18, r: 0 },
            { top: 18, right: 18, r: 90 },
            { bottom: 18, right: 18, r: 180 },
            { bottom: 18, left: 18, r: 270 },
          ].map((pos, i) => (
            <svg
              key={i}
              viewBox="0 0 40 40"
              width={52}
              height={52}
              style={{ position: "absolute", ...pos, transform: `rotate(${pos.r}deg)`, opacity: 0.9 }}
            >
              <path d="M4 26 V10 a6 6 0 0 1 6-6 H26" stroke="#F7F7F4" strokeWidth="7" fill="none" strokeLinecap="round" />
            </svg>
          ))}
          {/* scan sweep */}
          {scanning ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: scanY * (H - 6),
                height: 6,
                backgroundColor: "#7FBE96",
                boxShadow: "0 0 34px 10px rgba(127,190,150,0.65)",
              }}
            />
          ) : null}
          {/* verified overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `rgba(26,40,32,${done * 0.32})`,
            }}
          >
            <div
              style={{
                opacity: done,
                transform: `scale(${0.6 + done * 0.4})`,
                display: "flex",
                alignItems: "center",
                gap: 18,
                backgroundColor: C.terra,
                borderRadius: 999,
                padding: "22px 44px",
              }}
            >
              <svg viewBox="0 0 24 24" width={44} height={44} fill="none" stroke="#FFFFFF" strokeWidth="3">
                <path d="M5 13 l4.5 4.5 L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontFamily: FF.body, fontWeight: 700, fontSize: 40, color: "#FFFFFF" }}>
                Verified · +15 min
              </span>
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "26px 12px 6px",
          }}
        >
          <span style={{ fontFamily: FF.body, fontWeight: 500, fontSize: 34, color: C.inkMid }}>
            "Clean your desk"
          </span>
          <span
            style={{
              fontFamily: FF.body,
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: scanning ? C.clay : C.terra,
            }}
          >
            {scanning ? "AI checking…" : done > 0.05 ? "Proof accepted" : "Photo proof"}
          </span>
        </div>
      </div>
    </div>
  );
};

// Parent-mode approval card: kid submits a finished task, parent taps Approve.
const ApproveVisual = ({ delay = 14 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const tapAt = delay + 34;
  const tap = spring({ frame: frame - tapAt, fps, config: { damping: 12 } });
  const tapScale = frame < tapAt ? 1 : 1 - Math.sin(Math.min((frame - tapAt) / 8, 1) * Math.PI) * 0.08;
  const approved = spring({ frame: frame - tapAt - 10, fps, config: { damping: 13 } });
  return (
    <div
      style={{
        position: "absolute",
        top: 940,
        left: 110,
        right: 110,
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div
        style={{
          opacity: rise,
          transform: `translateY(${(1 - rise) * 40}px)`,
          backgroundColor: C.card,
          borderRadius: 40,
          padding: "42px 46px",
          boxShadow: "0 10px 40px rgba(26,40,32,0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 26, marginBottom: 34 }}>
          <div
            style={{
              width: 86,
              height: 86,
              borderRadius: 43,
              backgroundColor: C.sageLo,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FF.body,
              fontWeight: 700,
              fontSize: 30,
              color: C.sage,
            }}
          >
            M
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FF.body, fontWeight: 700, fontSize: 38, color: C.inkDeep }}>
              Maya finished a task
            </div>
            <div style={{ fontFamily: FF.body, fontWeight: 500, fontSize: 30, color: C.inkMid, marginTop: 8 }}>
              "Clean your room" · photo attached
            </div>
          </div>
          <span
            style={{
              fontFamily: FF.body,
              fontWeight: 700,
              fontSize: 24,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: C.clay,
              backgroundColor: C.clayLo,
              padding: "10px 20px",
              borderRadius: 999,
            }}
          >
            Pending
          </span>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          <div
            style={{
              flex: 1.4,
              transform: `scale(${tapScale})`,
              backgroundColor: C.deep,
              borderRadius: 999,
              padding: "26px 0",
              textAlign: "center",
              fontFamily: FF.body,
              fontWeight: 700,
              fontSize: 34,
              color: "#F7F7F4",
            }}
          >
            Approve
          </div>
          <div
            style={{
              flex: 1,
              backgroundColor: C.sand,
              borderRadius: 999,
              padding: "26px 0",
              textAlign: "center",
              fontFamily: FF.body,
              fontWeight: 700,
              fontSize: 34,
              color: C.inkMid,
            }}
          >
            Reject
          </div>
        </div>
      </div>
      <div
        style={{
          alignSelf: "center",
          opacity: approved,
          transform: `scale(${0.6 + approved * 0.4})`,
          display: "flex",
          alignItems: "center",
          gap: 16,
          backgroundColor: C.terra,
          borderRadius: 999,
          padding: "20px 40px",
        }}
      >
        <svg viewBox="0 0 24 24" width={38} height={38} fill="none" stroke="#FFFFFF" strokeWidth="3">
          <path d="M5 13 l4.5 4.5 L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: FF.body, fontWeight: 700, fontSize: 34, color: "#FFFFFF" }}>
          Approved · 20 min sent to Maya
        </span>
      </div>
    </div>
  );
};

const AppleLogo = ({ size = 34, color = "#1A2820" }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={color} style={{ marginTop: -4 }}>
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.03 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702" />
  </svg>
);

const CtaVisual = ({ delay = 16 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 13 } });
  const badge = spring({ frame: frame - delay - 10, fps, config: { damping: 200 } });
  const search = spring({ frame: frame - delay - 20, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: "absolute",
        top: 1000,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 36,
      }}
    >
      <div style={{ transform: `scale(${s})` }}>
        <svg viewBox="0 0 100 100" width={220} height={220}>
          <path d="M50 92 C50 70 50 55 50 42" stroke={C.deep} strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M50 46 C36 46 26 38 24 24 C40 24 50 32 50 46 Z" fill={C.sage} />
          <path d="M50 38 C62 38 72 30 74 18 C58 18 50 26 50 38 Z" fill={C.terra} />
        </svg>
      </div>
      <div
        style={{
          opacity: badge,
          transform: `translateY(${(1 - badge) * 18}px)`,
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontFamily: FF.body,
          fontWeight: 700,
          fontSize: 30,
          letterSpacing: 5,
          textTransform: "uppercase",
          color: C.inkDeep,
          backgroundColor: C.card,
          border: `2px solid rgba(26,40,32,0.14)`,
          padding: "18px 40px",
          borderRadius: 999,
        }}
      >
        <AppleLogo size={32} />
        Now on iOS
      </div>
      <div
        style={{
          opacity: s,
          fontFamily: FF.body,
          fontWeight: 700,
          fontSize: 40,
          color: "#F7F7F4",
          backgroundColor: C.deep,
          padding: "30px 64px",
          borderRadius: 999,
        }}
      >
        Download Drift — free
      </div>
      <div
        style={{
          opacity: search,
          transform: `translateY(${(1 - search) * 14}px)`,
          display: "flex",
          alignItems: "center",
          gap: 18,
          backgroundColor: C.sand,
          borderRadius: 999,
          padding: "16px 36px",
        }}
      >
        <svg viewBox="0 0 24 24" width={30} height={30} fill="none" stroke={C.inkMid} strokeWidth="2.4">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 L21 21" strokeLinecap="round" />
        </svg>
        <span style={{ fontFamily: FF.body, fontWeight: 500, fontSize: 32, color: C.inkMid }}>
          search: <span style={{ color: C.inkDeep, fontWeight: 700 }}>drift productivity</span>
        </span>
      </div>
    </div>
  );
};

// Full-bleed AI b-roll (clips in public/broll/) with headline overlay.
const BrollScene = ({ scene, audioBase }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 8, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp" }
  );
  const rise = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ backgroundColor: "#0B1A11", opacity: fadeIn * fadeOut }}>
      <OffthreadVideo
        src={staticFile(`broll/${scene.src}`)}
        muted
        loop
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(11,26,17,0.45) 0%, rgba(11,26,17,0) 34%, rgba(11,26,17,0) 55%, rgba(11,26,17,0.78) 100%)",
        }}
      />
      <div style={{ position: "absolute", top: 90, left: 100, display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontFamily: FF.mark, fontWeight: 700, fontSize: 40, letterSpacing: 6, color: "#F7F7F4" }}>
          DRIFT
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 360,
          left: 100,
          right: 100,
          opacity: rise,
          transform: `translateY(${(1 - rise) * 40}px)`,
        }}
      >
        {scene.kicker ? (
          <div
            style={{
              fontFamily: FF.body,
              fontWeight: 700,
              fontSize: 30,
              letterSpacing: 8,
              textTransform: "uppercase",
              color: "#CFE0CC",
              marginBottom: 28,
            }}
          >
            {scene.kicker}
          </div>
        ) : null}
        <Headline text={scene.headline} size={96} color="#F7F7F4" delay={10} />
      </div>
      {scene.voiceover ? <Caption text={scene.voiceover} /> : null}
      {scene.audio ? <Audio src={staticFile(`${audioBase}/${scene.audio}`)} /> : null}
    </AbsoluteFill>
  );
};

// ── scene assembly ───────────────────────────────────────────

const VISUALS = {
  hook: null,
  shield: ShieldVisual,
  tasks: TasksVisual,
  earn: EarnVisual,
  challenge: ChallengeVisual,
  proof: ProofVisual,
  approve: ApproveVisual,
  cta: CtaVisual,
};

const Scene = ({ scene, audioBase }) => {
  if (scene.visual === "broll" && scene.src) {
    return <BrollScene scene={scene} audioBase={audioBase} />;
  }
  const Visual = VISUALS[scene.visual] || null;
  const isHook = scene.visual === "hook";
  const isCta = scene.visual === "cta";
  return (
    <SceneShell bg={isCta ? C.sand : C.paper}>
      <CenterCol top={isHook ? 560 : 380}>
        {scene.kicker ? <Kicker>{scene.kicker}</Kicker> : null}
        <Headline text={scene.headline} size={isHook ? 124 : 96} />
      </CenterCol>
      {Visual ? <Visual /> : null}
      {scene.voiceover ? <Caption text={scene.voiceover} /> : null}
      {scene.audio ? <Audio src={staticFile(`${audioBase}/${scene.audio}`)} /> : null}
    </SceneShell>
  );
};

export const Promo = ({ scenes, audioBase = "audio" }) => {
  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: C.paper }}>
      {scenes.map((scene, i) => {
        const el = (
          <Sequence
            key={i}
            from={from}
            durationInFrames={scene.frames || 105}
            name={`${i + 1}-${scene.visual}`}
          >
            <Scene scene={scene} audioBase={audioBase} />
          </Sequence>
        );
        from += scene.frames || 105;
        return el;
      })}
    </AbsoluteFill>
  );
};
