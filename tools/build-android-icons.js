/**
 * build-android-icons.js
 *
 * Derives the whole Android icon set from the one iOS app icon, so there is a
 * single source of truth for the artwork. Re-run after changing that icon:
 *
 *     node tools/build-android-icons.js
 *
 * Never hand-edit the PNGs in assets/ — this overwrites them.
 *
 * WHY EACH OUTPUT EXISTS
 *   icon.png             legacy square launcher icon + the Play listing source.
 *   adaptive-icon.png    foreground layer; Android masks it to the launcher's
 *                        shape, so the artwork is inset to the 66% safe zone.
 *   notification-icon.png status bar. Android throws away the colour and keeps
 *                        ONLY the alpha channel — ship a coloured icon here and
 *                        users get a solid white blob.
 *   monochrome-icon.png  Android 13+ themed icons.
 *
 * The iOS icon is a bright glow on a flat dark squircle, which is what makes
 * this derivable: the squircle's black exterior floods away cleanly, and
 * luminance doubles as an alpha mask for the silhouettes.
 */
const path = require('path');
const Jimp = require('jimp-compact');
const SRC = path.join(__dirname, '..', 'ios/Drift/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png');
const OUT = path.join(__dirname, '..', 'assets') + '/';
const BG = { r: 9, g: 18, b: 16 };          // sampled squircle interior
const lum = (r,g,b) => 0.299*r + 0.587*g + 0.114*b;

(async () => {
  const src = await Jimp.read(SRC);
  const W = src.bitmap.width;

  // ---- 1. Flood-fill the pure-black squircle exterior with the interior colour.
  // Only the outside is pure black (interior min luminance measured at 13), and
  // BFS from the corners keeps the fill from leaking into the artwork.
  const flat = src.clone();
  const d = flat.bitmap.data;
  const seen = new Uint8Array(W * W);
  const stack = [0, W - 1, (W - 1) * W, W * W - 1];
  stack.forEach(p => { seen[p] = 1; });
  while (stack.length) {
    const p = stack.pop();
    const i = p * 4;
    if (lum(d[i], d[i+1], d[i+2]) >= 13) continue;  // 13 = interior floor: swallows the squircle's anti-aliased rim
    d[i] = BG.r; d[i+1] = BG.g; d[i+2] = BG.b; d[i+3] = 255;
    const x = p % W, y = (p / W) | 0;
    const push = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= W || ny >= W) return;
      const np = ny * W + nx;
      if (!seen[np]) { seen[np] = 1; stack.push(np); }
    };
    push(x+1,y); push(x-1,y); push(x,y+1); push(x,y-1);
  }
  await flat.writeAsync(OUT + 'icon.png');

  // ---- 2. Adaptive foreground: artwork inside the 66% safe zone.
  // Measured artwork bbox is y[0.292..0.825]; 0.94 pulls it clear of the mask
  // with margin on every launcher shape.
  const S = 0.94, side = Math.round(W * S), off = Math.round((W - side) / 2);
  const fg = new Jimp(W, W, 0x00000000);
  fg.composite(flat.clone().resize(side, side), off, off);
  await fg.writeAsync(OUT + 'adaptive-icon.png');

  // ---- 3. Notification icon. Android discards colour and keeps only alpha,
  // so drive alpha from luminance: the glow becomes the silhouette, the dark
  // background falls away, and the gradient stays anti-aliased.
  const note = flat.clone().resize(96, 96);
  const nd = note.bitmap.data;
  for (let i = 0; i < nd.length; i += 4) {
    const a = Math.max(0, Math.min(1, (lum(nd[i], nd[i+1], nd[i+2]) - 25) / 175));
    nd[i] = nd[i+1] = nd[i+2] = 255;
    nd[i+3] = Math.round(a * 255);
  }
  await note.writeAsync(OUT + 'notification-icon.png');

  // ---- 4. Monochrome layer for Android 13 themed icons: same alpha-from-
  // luminance trick at launcher resolution, inset to the adaptive safe zone.
  const mono = new Jimp(W, W, 0x00000000);
  const art = flat.clone().resize(side, side);
  const ad = art.bitmap.data;
  for (let i = 0; i < ad.length; i += 4) {
    const a = Math.max(0, Math.min(1, (lum(ad[i], ad[i+1], ad[i+2]) - 25) / 175));
    ad[i] = ad[i+1] = ad[i+2] = 255;
    ad[i+3] = Math.round(a * 255);
  }
  mono.composite(art, off, off);
  await mono.writeAsync(OUT + 'monochrome-icon.png');

  console.log('wrote icon.png, adaptive-icon.png, notification-icon.png, monochrome-icon.png');
})().catch(e => { console.error(e); process.exit(1); });
