// Footage intake.
//
// Clips live in public/capture (real app screen recordings) and public/broll
// (live-action or AI-generated). The script writer can only use footage it
// knows about, so every clip is auto-described once by a vision model and the
// description cached — drop a file in the folder and the pipeline picks it up
// with no manifest editing.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { ROOT, KEYS } from "./openai.mjs";
import { chat } from "./openai.mjs";
import { listClips, extractFrames, asBase64, probe } from "./media.mjs";

const manifestPath = (subdir) => join(ROOT, "public", subdir, "manifest.json");

function loadManifest(subdir) {
  const p = manifestPath(subdir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveManifest(subdir, data) {
  writeFileSync(manifestPath(subdir), JSON.stringify(data, null, 2));
}

/**
 * Return [{file, describes, seconds}] for a footage folder, describing any
 * clip we haven't seen before. Descriptions are cached by filename so this
 * costs one vision call per new clip, ever.
 */
export async function describeClips(subdir, { scratchDir } = {}) {
  const files = listClips(subdir);
  if (!files.length) return [];

  const manifest = loadManifest(subdir);
  let changed = false;

  for (const file of files) {
    if (manifest[file]?.describes) continue;

    const full = join(ROOT, "public", subdir, file);
    let seconds = 0;
    try {
      seconds = probe(full).seconds;
    } catch {
      console.log(`[capture] skipping unreadable clip: ${file}`);
      continue;
    }

    let describes = file.replace(/[-_]/g, " ").replace(/\.\w+$/, "");
    if (KEYS.openai()) {
      try {
        const dir = scratchDir || join(ROOT, "content", "state", "clip-frames");
        mkdirSync(dir, { recursive: true });
        const [frame] = extractFrames(full, [Math.min(1, seconds / 2)], dir);
        describes = await chat({
          system:
            "You label short video clips for a marketing script writer. " +
            "Reply with ONE short phrase (max 12 words) describing what is happening " +
            "and what is visible. No preamble, no punctuation at the end.",
          user: "What does this frame show?",
          images: [asBase64(frame)],
          temperature: 0.2,
        });
        describes = String(describes).trim().replace(/^["']|["']$/g, "");
      } catch (err) {
        console.log(`[capture] could not auto-describe ${file} (${err.message.slice(0, 80)}) — using filename`);
      }
    }

    manifest[file] = { describes, seconds: Number(seconds.toFixed(2)) };
    changed = true;
    console.log(`[capture] ${subdir}/${file} -> "${describes}"`);
  }

  // Drop entries for clips that no longer exist.
  for (const key of Object.keys(manifest)) {
    if (!files.includes(key)) {
      delete manifest[key];
      changed = true;
    }
  }
  if (changed) saveManifest(subdir, manifest);

  return files.map((file) => ({ file, ...manifest[file] }));
}

/** UDID of a booted simulator, or null. */
export function bootedSimulator() {
  try {
    const out = execFileSync("xcrun", ["simctl", "list", "devices", "booted", "-j"], { encoding: "utf8" });
    const data = JSON.parse(out);
    for (const devices of Object.values(data.devices || {})) {
      const booted = devices.find((d) => d.state === "Booted");
      if (booted) return { udid: booted.udid, name: booted.name };
    }
  } catch {
    /* Xcode tooling not available */
  }
  return null;
}

/**
 * Record the booted simulator for `seconds`. Drive the app however you like
 * while it runs — this only captures the screen.
 *
 *   node -e "import('./scripts/lib/capture.mjs').then(m=>m.recordSimulator(12,'shield-block.mp4'))"
 */
export function recordSimulator(seconds, filename) {
  const sim = bootedSimulator();
  if (!sim) throw new Error("No booted iOS Simulator. Boot one and install the Drift dev build first.");

  const dir = join(ROOT, "public", "capture");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, filename);

  console.log(`[capture] recording ${sim.name} for ${seconds}s -> public/capture/${filename}`);
  const proc = spawn("xcrun", ["simctl", "io", sim.udid, "recordVideo", "--codec", "h264", "-f", out], {
    stdio: "ignore",
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // simctl finalises the file on SIGINT; SIGKILL leaves it corrupt.
      proc.kill("SIGINT");
    }, seconds * 1000);
    proc.on("exit", () => {
      clearTimeout(timer);
      if (!existsSync(out)) return reject(new Error("Recording produced no file"));
      resolve({ file: filename, path: out, seconds: probe(out).seconds });
    });
    proc.on("error", reject);
  });
}

/**
 * Same idea as describeClips, for still screenshots. Labels each one once and
 * caches it, so dropping a screenshot in public/shots/ is all it takes for the
 * script writer to know what that screen shows.
 */
export async function describeShots({ subdir = "shots" } = {}) {
  const dir = join(ROOT, "public", subdir);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
  if (!files.length) return [];

  const manifestPath = join(dir, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : {};
  let changed = false;

  for (const file of files) {
    if (manifest[file]?.describes) continue;
    let describes = file.replace(/\.\w+$/, "");
    if (KEYS.openai()) {
      try {
        describes = await chat({
          system:
            "You label screenshots of a mobile app for a marketing script writer. " +
            "Reply with ONE short phrase (max 12 words) naming the screen and what it shows. " +
            "No preamble, no trailing punctuation.",
          user: "What screen is this?",
          images: [asBase64(join(dir, file))],
          temperature: 0.2,
        });
        describes = String(describes).trim().replace(/^["']|["']$/g, "");
      } catch (err) {
        console.log(`[shots] could not describe ${file} (${err.message.slice(0, 70)})`);
      }
    }
    manifest[file] = { describes };
    changed = true;
    console.log(`[shots] ${file} -> "${describes}"`);
  }

  for (const k of Object.keys(manifest)) if (!files.includes(k)) { delete manifest[k]; changed = true; }
  if (changed) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return files.map((file) => ({ file, ...manifest[file] }));
}
