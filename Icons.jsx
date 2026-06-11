import React from "react";
import Svg, { Path, Circle, Rect, Line, Polyline, Polygon } from "react-native-svg";

// All icons accept { size, color } and render at the given viewBox 24x24
const make = (paths) => ({ size = 20, color = "#1A8050", strokeWidth = 2, fill = "none" }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {paths({ color, strokeWidth, fill })}
  </Svg>
);

// ─── Category icons ──────────────────────────────────────────
export const BriefcaseIcon = make(({ color, strokeWidth }) => (
  <>
    <Rect x="3" y="7" width="18" height="13" rx="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Line x1="3" y1="13" x2="21" y2="13" stroke={color} strokeWidth={strokeWidth} />
  </>
));

export const DumbbellIcon = make(({ color, strokeWidth }) => (
  <>
    <Rect x="2" y="9" width="3" height="6" rx="1" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Rect x="19" y="9" width="3" height="6" rx="1" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Rect x="5" y="10.5" width="2" height="3" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Rect x="17" y="10.5" width="2" height="3" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Line x1="7" y1="12" x2="17" y2="12" stroke={color} strokeWidth={strokeWidth} />
  </>
));

export const LeafIcon = make(({ color, strokeWidth }) => (
  <Path d="M21 3c0 9-7 16-16 16-1 0-2-.1-2-.1S3 11 11 5c4-3 10-2 10-2zM3 21l9-9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
));

export const BookIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Path d="M20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
  </>
));

export const HomeIcon = make(({ color, strokeWidth }) => (
  <Path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-3v-7H10v7H5a2 2 0 0 1-2-2z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
));

export const ChatIcon = make(({ color, strokeWidth }) => (
  <Path d="M21 12a8 8 0 0 1-12 7l-5 1 1-4a8 8 0 1 1 16-4z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
));

// ─── Level icons (growth tree progression) ───────────────────
export const SeedlingIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M12 21V11" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M12 11C8 11 6 8 6 5c3 0 6 2 6 6z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Path d="M12 13C16 13 18 10 18 7c-3 0-6 2-6 6z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
  </>
));

export const SproutIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M12 21v-9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M12 12c-3 0-5-2-5-5 3 0 5 2 5 5z M12 14c3 0 5-2 5-5-3 0-5 2-5 5z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
  </>
));

export const TreeIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M12 22v-5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M12 2C8 6 6 9 6 12a6 6 0 0 0 12 0c0-3-2-6-6-10z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
  </>
));

export const TentIcon = make(({ color, strokeWidth }) => (
  <Path d="M12 3l9 17H3z M12 3v17 M7 20l5-9 5 9" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
));

export const PineIcon = make(({ color, strokeWidth }) => (
  <Path d="M12 2l-5 7h3l-4 5h3l-4 5h14l-4-5h3l-4-5h3z M12 19v3" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
));

export const GrassIcon = make(({ color, strokeWidth }) => (
  <Path d="M4 20c2-6 4-9 4-12 0 3 2 6 4 12 M12 20c2-7 4-11 4-14 0 3 2 7 4 14" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
));

export const MountainIcon = make(({ color, strokeWidth }) => (
  <Path d="M3 20l6-11 4 6 3-4 5 9z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
));

// ─── UI / utility icons ──────────────────────────────────────
export const LockIcon = make(({ color, strokeWidth }) => (
  <>
    <Rect x="4" y="11" width="16" height="10" rx="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M8 11V7a4 4 0 0 1 8 0v4" stroke={color} strokeWidth={strokeWidth} fill="none" />
  </>
));

export const UnlockIcon = make(({ color, strokeWidth }) => (
  <>
    <Rect x="4" y="11" width="16" height="10" rx="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M8 11V7a4 4 0 0 1 7.5-2" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
  </>
));

export const SparkleIcon = make(({ color, strokeWidth }) => (
  <Path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
));

export const CheckIcon = make(({ color, strokeWidth }) => (
  <Polyline points="4,12 10,18 20,6" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
));

export const CloseIcon = make(({ color, strokeWidth }) => (
  <>
    <Line x1="5" y1="5" x2="19" y2="19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="19" y1="5" x2="5" y2="19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </>
));

export const ShieldKeyIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Circle cx="12" cy="11" r="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M12 13v4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </>
));

export const CameraIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M3 8h4l2-3h6l2 3h4v11H3z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Circle cx="12" cy="13" r="4" stroke={color} strokeWidth={strokeWidth} fill="none" />
  </>
));

export const ImageIcon = make(({ color, strokeWidth }) => (
  <>
    <Rect x="3" y="4" width="18" height="16" rx="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Circle cx="9" cy="10" r="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M21 17l-5-5-9 9" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
  </>
));

export const PhoneIcon = make(({ color, strokeWidth }) => (
  <>
    <Rect x="7" y="2" width="10" height="20" rx="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Line x1="11" y1="19" x2="13" y2="19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </>
));

export const ClipboardIcon = make(({ color, strokeWidth }) => (
  <>
    <Rect x="5" y="4" width="14" height="17" rx="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Rect x="9" y="2" width="6" height="4" rx="1" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Line x1="8" y1="11" x2="16" y2="11" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="8" y1="15" x2="14" y2="15" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </>
));

export const ChartIcon = make(({ color, strokeWidth }) => (
  <>
    <Line x1="4" y1="20" x2="20" y2="20" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Rect x="6" y="12" width="3" height="8" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Rect x="11" y="8" width="3" height="12" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Rect x="16" y="4" width="3" height="16" stroke={color} strokeWidth={strokeWidth} fill="none" />
  </>
));

export const TrophyIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M7 4h10v4a5 5 0 0 1-10 0z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Path d="M7 6H4v2a3 3 0 0 0 3 3 M17 6h3v2a3 3 0 0 1-3 3" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M9 14h6v3a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z M8 20h8" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </>
));

export const BoltIcon = make(({ color, strokeWidth }) => (
  <Polygon points="13,2 4,14 11,14 9,22 20,10 13,10" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
));

export const BellIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M6 16V11a6 6 0 0 1 12 0v5l1 2H5z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Path d="M10 20a2 2 0 0 0 4 0" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
  </>
));

export const UsersIcon = make(({ color, strokeWidth }) => (
  <>
    <Circle cx="9" cy="9" r="3" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
    <Circle cx="17" cy="8" r="2.5" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M16 13h1a4 4 0 0 1 4 4v1" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
  </>
));

export const ShareIcon = make(({ color, strokeWidth }) => (
  <>
    <Circle cx="18" cy="5" r="3" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Circle cx="6" cy="12" r="3" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Circle cx="18" cy="19" r="3" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </>
));

export const WaveIcon = make(({ color, strokeWidth }) => (
  // hello/wave hand
  <Path d="M7 11V6a1.5 1.5 0 0 1 3 0v4 M10 10V4a1.5 1.5 0 0 1 3 0v6 M13 10V5a1.5 1.5 0 0 1 3 0v8 M16 11V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-13 3l-3-5a1.5 1.5 0 0 1 2.5-1.5z"
    stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
));

export const TargetIcon = make(({ color, strokeWidth }) => (
  <>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Circle cx="12" cy="12" r="5" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Circle cx="12" cy="12" r="1.5" stroke={color} strokeWidth={strokeWidth} fill={color} />
  </>
));

export const CakeIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M4 21V13a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Line x1="4" y1="16" x2="20" y2="16" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M9 11V8 M12 11V7 M15 11V8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </>
));

export const HoleIcon = make(({ color, strokeWidth }) => (
  // downward spiral / drain
  <>
    <Path d="M3 8c2-3 7-4 9-4s7 1 9 4c-2 3-7 4-9 4s-7-1-9-4z" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M7 10c2 4 4 11 5 11s3-7 5-11" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
  </>
));

export const FireIcon = make(({ color, strokeWidth }) => (
  <Path d="M12 22a6 6 0 0 0 6-6c0-3-3-4-3-7 0 0-1 2-3 3 0-2 0-5-3-9 0 4-5 7-5 13a6 6 0 0 0 6 6z"
    stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
));

export const RunIcon = make(({ color, strokeWidth }) => (
  <>
    <Circle cx="15" cy="4" r="2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M5 21l4-7 3-2-2-4 6 3 3 6 M9 12l-3 1" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
  </>
));

export const LegIcon = make(({ color, strokeWidth }) => (
  <Path d="M10 3v9l-3 9 M14 3v8l4 10" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
));

export const SurfIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M3 18c2-1 3-1 5 0s3 1 5 0 3-1 5 0 3 1 5 0" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
    <Path d="M8 14c2-6 8-10 13-10-1 5-5 11-11 13" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
  </>
));

export const SpeakerIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M3 10v4h4l5 4V6L7 10z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Path d="M16 8a5 5 0 0 1 0 8" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
  </>
));

export const WarnIcon = make(({ color, strokeWidth }) => (
  <>
    <Path d="M12 3l10 18H2z" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
    <Line x1="12" y1="10" x2="12" y2="15" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Circle cx="12" cy="18" r="1" fill={color} />
  </>
));

// Level by index (matches LEVELS order)
export const LevelIcon = ({ index, ...rest }) => {
  const icons = [SeedlingIcon, SproutIcon, TreeIcon, TentIcon, PineIcon, GrassIcon, MountainIcon];
  const Icon = icons[index] || SeedlingIcon;
  return <Icon {...rest} />;
};

// Category by key (matches CATS keys)
export const CategoryIcon = ({ cat, ...rest }) => {
  const map = {
    work: BriefcaseIcon, physical: DumbbellIcon, outdoor: LeafIcon,
    learning: BookIcon, life: HomeIcon, social: ChatIcon,
  };
  const Icon = map[cat] || BriefcaseIcon;
  return <Icon {...rest} />;
};
