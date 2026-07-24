import { Composition } from "remotion";
import { Promo } from "./Promo.jsx";
import defaultScript from "./defaultScript.js";

const FPS = 30;

const totalFrames = (scenes) =>
  scenes.reduce((sum, s) => sum + (s.frames || 105), 0);

export const Root = () => (
  <Composition
    id="DriftPromo"
    component={Promo}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={defaultScript}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(totalFrames(props.scenes), FPS),
    })}
  />
);
