import { Composition } from "remotion";
import { Promo } from "./Promo.jsx";
import { Native } from "./Native.jsx";
import defaultScript from "./defaultScript.js";
import nativeDefault from "./nativeDefault.js";

const FPS = 30;

const sumFrames = (items, fallback) =>
  items.reduce((sum, s) => sum + (s.frames || fallback), 0);

export const Root = () => (
  <>
    {/* Original brand-film look — kept for landing pages and App Store previews. */}
    <Composition
      id="DriftPromo"
      component={Promo}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaultScript}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(sumFrames(props.scenes || [], 105), FPS),
      })}
    />
    {/* TikTok-native: footage-first, karaoke captions, hard cuts. */}
    <Composition
      id="DriftNative"
      component={Native}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={nativeDefault}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(sumFrames(props.beats || [], 60), FPS),
      })}
    />
  </>
);
