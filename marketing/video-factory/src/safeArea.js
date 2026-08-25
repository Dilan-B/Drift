// TikTok's own UI covers the edges of the frame. Anything that must be READ
// has to sit inside this box, or the app's chrome lands on top of it.
//
// Single source of truth: the renderer positions against it and the QC gate
// checks against it. If they drift apart, QC silently stops catching the very
// thing it exists to catch.
export const SAFE = {
  width: 1080,
  height: 1920,
  top: 250,     // "Following | For You" tabs, search icon
  bottom: 480,  // username, caption, sound ticker, progress bar
  left: 60,
  right: 260,   // like / comment / share / profile rail
};

export const BOX = {
  x0: SAFE.left,
  y0: SAFE.top,
  x1: SAFE.width - SAFE.right,
  y1: SAFE.height - SAFE.bottom,
};

export const BOX_W = BOX.x1 - BOX.x0;
export const BOX_H = BOX.y1 - BOX.y0;

/** Where the karaoke caption block sits — lower third, still clear of chrome. */
export const CAPTION_Y = 1180;
