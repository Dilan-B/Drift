import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Single source of truth for every factual claim a generated video is allowed
// to make. The QC gate lints scripts against this file, so a wrong price or an
// invented feature fails the build instead of landing on the brand account.
//
// A previous batch of scripts shipped "Free on the App Store" months after the
// app went paid. That is exactly the class of error this file exists to stop —
// when a fact changes, change it HERE and every future video follows.

export const FACTS = {
  name: "Drift",
  tagline: "Earn your scroll.",
  platform: "iOS",
  appStoreUrl: "https://apps.apple.com/app/drift-screentime/id6778215875",
  // What a viewer types into App Store search to actually find it. "Drift"
  // alone returns a pile of unrelated apps, so the CTA must say this in full.
  appStoreSearch: "Drift Productivity",
  price: "$4.99/month",
  priceNumeric: 4.99,
  annualPrice: "$29.99/year",
  annualPriceNumeric: 29.99,
  trialDays: 7,
  // A base seat plus each child; the app labels this an estimate because App
  // Store price points are not linear, so never state a family total as fact.
  familyPricing: "$4.99/month plus $3 per child",
  // Things that are TRUE and safe to say on camera.
  truths: [
    "Blocks distracting apps behind an iOS Screen Time shield until you earn time",
    "You earn screen-time minutes by completing real-life tasks",
    "AI verifies your proof photo actually shows the task done",
    "Parents can approve tasks and send time to their kid's phone",
    "Works hands-free with Siri via App Intents",
    "No ads, no tracking, no data selling",
    "Built by two teenagers who were tired of their own doomscrolling",
  ],
};

// Hard-fail claim lint. Each rule: if `pattern` matches and no `unless`
// exemption applies, the script is rejected. `why` is fed back to the model so
// the rewrite actually fixes the problem instead of rerolling blindly.
export const CLAIM_RULES = [
  {
    id: "free-app",
    // Lookahead-based matching kept misfiring here: "free for three days" is
    // fine, "free forever" is not, and the two differ by one word downstream.
    // Proximity is the robust test — "free" is acceptable only when it sits
    // near "trial" or a day-count, i.e. it is describing the trial.
    check: (text) => {
      const tokens = String(text).toLowerCase().match(/[a-z0-9']+/g) || [];
      const hits = [];
      tokens.forEach((tok, i) => {
        if (tok !== "free") return;
        const window = tokens.slice(Math.max(0, i - 4), i + 5);
        const nearTrial = window.includes("trial") || window.includes("trials");
        // Spelled-out counts matter as much as digits — "seven days free" is
        // the natural phrasing and was tripping the rule for want of the word.
        const nearDays = window.some((w) => /^(day|days)$/.test(w)) &&
          window.some((w) => /^(\d{1,2}|one|two|three|four|five|six|seven|ten|fourteen|few)$/.test(w));
        if (!nearTrial && !nearDays) {
          hits.push(tokens.slice(Math.max(0, i - 2), i + 3).join(" "));
        }
      });
      return hits;
    },
    why: `Drift is $0.99/month, not free. The word "free" is only allowed as part of the 3-day free trial (e.g. "3-day free trial", "free for 3 days").`,
  },
  {
    id: "wrong-price",
    // A lookahead-based regex can't do this safely: on "$0.99/month" it would
    // simply retry at "99/month" and fire a false positive. So pull out every
    // price-like token and compare the parsed number instead.
    check: (text) => {
      const hits = [];
      const monthly = /\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars?\s*)?(?:\/|per\s+|a\s+|\s+)?(mo\b|month|monthly)/gi;
      for (const m of text.matchAll(monthly)) {
        if (Number(m[1]) !== FACTS.priceNumeric) hits.push(m[0].trim());
      }
      // Require a currency marker, or "in 1 year" reads as a price.
      const annual = /(?:\$\s*(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*dollars?)\s*(?:\/|per\s+|a\s+|\s+)?(?:yr\b|year|annually|annual)/gi;
      for (const m of text.matchAll(annual)) {
        const n = Number(m[1] ?? m[2]);
        if (n !== FACTS.annualPriceNumeric) hits.push(m[0].trim());
      }
      // Written-out amounts the numeric pass can't see.
      const words = text.match(/\b(one|two|three|four|five|ten|twenty)\s+dollars?\s*(?:\/|per\s+|a\s+)?(?:mo\b|month)/gi);
      if (words) hits.push(...words);
      return hits;
    },
    why: `The only correct prices are ${FACTS.price} and ${FACTS.annualPrice}.`,
  },
  {
    id: "no-pricing",
    scope: "script",
    check: (text) => {
      const hits = [];
      const patterns = [
        /\$\s?\d+(?:\.\d{1,2})?/g,
        /\b\d+(?:\.\d{1,2})?\s*(?:dollars?|cents?|bucks?|quid|pounds?)\b/gi,
        /\b(?:ninety[- ]?nine|nine[- ]?nine)\s*cents?\b/gi,
        /\b(?:per|a)\s+month\b/gi,
        /\bmonthly\b/gi,
        /\bfree\s+trial\b/gi,
        /\btrial\b/gi,
        /\bsubscription\b|\bsubscribe\s+for\b/gi,
        /\bfree\b/gi,
        /\bpricing\b|\bcosts?\b|\bpaid\b|\bpay\b/gi,
      ];
      for (const re of patterns) for (const m of text.matchAll(re)) hits.push(m[0].trim());
      return hits;
    },
    why: "Video scripts must never mention price, cost, trials, subscriptions or the word 'free'. End on what the app does and the App Store, nothing about money.",
  },
  {
    id: "wrong-trial-length",
    check: (text) => {
      const hits = [];
      const re = /\b(\d+|one|two|three|five|seven|ten|fourteen)[\s-]*day[s]?\b(?=[^.]{0,24}\b(free|trial))/gi;
      const words = { one: 1, two: 2, three: 3, five: 5, seven: 7, ten: 10, fourteen: 14 };
      for (const m of text.matchAll(re)) {
        const n = words[m[1].toLowerCase()] ?? Number(m[1]);
        if (n !== FACTS.trialDays) hits.push(m[0].trim());
      }
      return hits;
    },
    why: `The trial is ${FACTS.trialDays} days.`,
  },
  {
    id: "android",
    pattern: /\bandroid\b|\bgoogle play\b|\bsamsung\b/i,
    why: "Drift is iOS-only. Never imply Android or Play Store availability.",
  },
  {
    id: "unverifiable-superlative",
    pattern: /\b(#1|number one|the best|world'?s best|guaranteed|clinically proven|scientifically proven)\b/i,
    why: "Unverifiable superlative — advertising risk. Describe the mechanism instead.",
  },
  {
    id: "medical-claim",
    pattern: /\b(cure|cures|treats?|diagnos\w*|adhd\s+(cure|treatment)|dopamine detox\w*)\b/i,
    why: "No medical or clinical claims. Drift is a productivity app, not a treatment.",
  },
  {
    id: "fake-scarcity",
    pattern: /\b(limited time|only \d+ (spots?|left)|act now|before it'?s gone|deleting this)\b/i,
    why: "False urgency — erodes trust and violates platform ad policy.",
  },
  {
    id: "impossible-uninstallable",
    pattern: /\b(can'?t be (deleted|uninstalled|removed)|impossible to (delete|bypass|remove))\b/i,
    why: "Untrue — Screen Time permissions can always be revoked. Overclaiming invites 1-star reviews.",
  },
  {
    id: "competitor-logo-callout",
    pattern: /\b(better than|beats)\s+(apple|opal|one ?sec|forest|freedom|screen time)\b/i,
    why: "Named-competitor comparison — legal and platform-policy risk on an automated post.",
  },
];

// Third-party marks we must not put on screen in an ad. Showing a locked
// TikTok logo *on TikTok* is a takedown magnet, and TikTok's own ad policy
// restricts depicting competitor platforms.
export const FORBIDDEN_ONSCREEN_ASSETS = [
  "tiktok.svg", "instagram.svg", "youtube.svg", "snapchat.svg", "x.svg", "reddit.svg",
];

// TikTok's own chrome covers the edges of the frame. The geometry lives in
// src/safeArea.js so the renderer and this gate can never disagree about it.
export { SAFE as SAFE_AREA, BOX as SAFE_BOX } from "../../src/safeArea.js";

/** Lint arbitrary copy. Returns [] when clean. */
/**
 * `scope` selects which rules apply. Default "copy" runs the rules that hold
 * everywhere; "script" adds the stricter video-only rules (no pricing talk at
 * all), which would otherwise fail the marketing docs that legitimately quote
 * a price.
 */
export function lintClaims(text, { label = "copy", scope = "copy" } = {}) {
  if (!text) return [];
  const found = [];
  for (const rule of CLAIM_RULES) {
    if (rule.scope && rule.scope !== scope) continue;
    // Rules too subtle for a single regex supply a `check` returning matches.
    if (rule.check) {
      for (const matched of rule.check(text)) {
        found.push({ rule: rule.id, label, matched, why: rule.why });
      }
      continue;
    }
    const hit = text.match(rule.pattern);
    if (!hit) continue;
    if (rule.unless && rule.unless.test(text)) {
      // Re-test with the exempt phrasing stripped, so "free trial" doesn't
      // launder a separate, genuinely bad "it's free" elsewhere in the line.
      const stripped = text.replace(new RegExp(rule.unless.source, "gi"), "");
      if (!rule.pattern.test(stripped)) continue;
    }
    found.push({ rule: rule.id, label, matched: hit[0], why: rule.why });
  }
  return found;
}

/** Lint a whole script object (headlines, kickers, voiceover, caption, hashtags). */
export function lintScript(script) {
  const issues = [];
  for (const [i, s] of (script.scenes || []).entries()) {
    for (const field of ["kicker", "headline", "voiceover", "caption"]) {
      issues.push(...lintClaims(s[field], { label: `scene[${i}].${field}`, scope: "script" }));
    }
    if (s.src && FORBIDDEN_ONSCREEN_ASSETS.includes(s.src)) {
      issues.push({
        rule: "competitor-logo-callout",
        label: `scene[${i}].src`,
        matched: s.src,
        why: "Third-party platform logo used as an on-screen asset in an ad.",
      });
    }
  }
  issues.push(...lintClaims(script.postCaption, { label: "postCaption", scope: "script" }));
  issues.push(...lintClaims((script.hashtags || []).join(" "), { label: "hashtags", scope: "script" }));
  return issues;
}

/** Compact brand brief injected into every model prompt. */
export function brandPrompt() {
  return [
    `${FACTS.name} — ${FACTS.platform} app. ${FACTS.tagline}`,
    `To tell someone where to get it, say: search "${FACTS.appStoreSearch}" on the App Store.`,
    `NEVER discuss money. No price, no cost, no trial, no subscription, and never`,
    `the word "free". If asked to give a reason to download, talk about what the app`,
    `does, not what it costs.`,
    `True things you may say:`,
    ...FACTS.truths.map((t) => `  - ${t}`),
    `NEVER say: anything about price, cost, trials, subscriptions or "free";`,
    `that it works on Android; superlatives like "#1" or "the best"; medical claims;`,
    `fake urgency; named competitor comparisons.`,
  ].join("\n");
}

/**
 * Settings that must hold for a run to be trustworthy. A .env can silently
 * revert — an editor restoring an older copy once wiped the redirect URI, the
 * AI-disclosure flag and the chosen voice all at once, and nothing noticed
 * until authorisation failed. Cheap to check, expensive to miss.
 */
export function preflight(env = process.env, repoRoot = null) {
  const problems = [];
  if (repoRoot) problems.push(...verifyAgainstApp(repoRoot));

  if (!env.OPENAI_API_KEY) problems.push("OPENAI_API_KEY is unset — QC cannot run, so nothing can post.");

  if (env.TIKTOK_CLIENT_KEY || env.TIKTOK_CLIENT_SECRET) {
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
      problems.push("Only one of TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET is set.");
    }
    const uri = env.TIKTOK_REDIRECT_URI || "";
    if (!uri.startsWith("https://")) {
      problems.push(`TIKTOK_REDIRECT_URI must be https (TikTok rejects http and localhost) — got "${uri}".`);
    }
  }

  if (env.TIKTOK_IS_AIGC !== undefined && !["true", "false"].includes(env.TIKTOK_IS_AIGC)) {
    problems.push(`TIKTOK_IS_AIGC should be "true" or "false" — got "${env.TIKTOK_IS_AIGC}".`);
  }
  if (env.TIKTOK_IS_AIGC === undefined) {
    problems.push("TIKTOK_IS_AIGC is unset — AI-generated posts would go out undisclosed. Set it to true.");
  }

  const privacy = env.TIKTOK_PRIVACY_LEVEL;
  if (privacy && !["SELF_ONLY", "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR"].includes(privacy)) {
    problems.push(`TIKTOK_PRIVACY_LEVEL "${privacy}" is not a value TikTok accepts.`);
  }

  return problems;
}

/**
 * Cross-check the facts above against the app's own source.
 *
 * This file went stale exactly the way it was built to prevent: the app was
 * repriced on main and nothing here noticed, so the linter began REJECTING the
 * correct price and ACCEPTING the old one. A source of truth that can silently
 * disagree with the truth is worse than none, so the run now checks itself.
 */
export function verifyAgainstApp(repoRoot) {
  const path = join(repoRoot, "useSubscription.js");
  if (!existsSync(path)) return [];
  const src = readFileSync(path, "utf8");

  const problems = [];
  const money = [...src.matchAll(/\$(\d+\.\d{2})/g)].map((m) => Number(m[1]));
  if (money.length) {
    if (!money.includes(FACTS.priceNumeric)) {
      problems.push(
        `FACTS.price says ${FACTS.price}, but useSubscription.js mentions ` +
        `${[...new Set(money)].map((n) => "$" + n.toFixed(2)).join(", ")}. The app was probably repriced.`
      );
    }
  }
  const trial = src.match(/(\d+)[\s-]*day free trial/i);
  if (trial && Number(trial[1]) !== FACTS.trialDays) {
    problems.push(`FACTS.trialDays says ${FACTS.trialDays}, but useSubscription.js says ${trial[1]}.`);
  }
  return problems;
}
