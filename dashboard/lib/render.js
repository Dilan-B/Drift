// Renders the internal metrics page. Pure: data in, HTML string out, so it can
// be exercised without a network call (see npm run preview).
//
// The two minute columns mean different things and are never added together:
//   focus  = tasks.minutes, how long the work took
//   earned = tasks.credits, the screen time that work paid out
//   net    = focus - earned, time that did not come back as app time

const CSS = `
:root{--paper:#FAF6EE;--card:#FFFDF8;--ink:#1D2B22;--mid:#5C6B62;--faint:#9AA8A0;
--line:#E4DED1;--sage:#4B7F63;--deep:#2F5D46;--warn:#B5564B;--gold:#C08B3E}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--paper:#12180F;
--card:#19211A;--ink:#EDE7DA;--mid:#A3B0A6;--faint:#6D7C72;--line:#2A342C;
--sage:#7FB894;--deep:#9ED0AE}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 -apple-system,
BlinkMacSystemFont,"SF Pro Text",Segoe UI,sans-serif;padding:24px 16px 72px;
-webkit-text-size-adjust:100%}
.wrap{max-width:1080px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.4px}
h2{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--sage);
margin:40px 0 12px;font-weight:600}
.sub{color:var(--mid);font-size:13px;margin:0 0 4px}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px}
.kpi{font-size:28px;font-weight:600;letter-spacing:-1px;line-height:1.1}
.kpi small{font-size:13px;font-weight:400;color:var(--mid);letter-spacing:0}
.lab{font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--faint);
margin-bottom:7px}
.note{font-size:12px;color:var(--mid);margin-top:6px;line-height:1.45}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:380px}
th{text-align:left;font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;
color:var(--faint);font-weight:600;padding:0 10px 8px}
td{padding:8px 10px;border-top:1px solid var(--line)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:9px;border-radius:5px;background:var(--sage);min-width:2px}
.track{background:var(--line);border-radius:5px;overflow:hidden}
.dim{color:var(--faint)}
.toggle{display:inline-flex;gap:2px;background:var(--line);border-radius:999px;
padding:3px;margin:10px 0 4px}
.toggle a{padding:5px 13px;border-radius:999px;font-size:12.5px;text-decoration:none;
color:var(--mid)}
.toggle a.on{background:var(--card);color:var(--ink);font-weight:600}
.foot{margin-top:44px;color:var(--faint);font-size:12px;border-top:1px solid var(--line);
padding-top:14px}
code{font-size:12.5px}
`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 17379 -> "290 h". Minutes stop being legible in the thousands.
const hrs = (m) => (m >= 120 ? `${Math.round(m / 60).toLocaleString()} h` : `${m} min`);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const kpi = (label, value, note = "") =>
  `<div class="card"><div class="lab">${esc(label)}</div><div class="kpi">${value}</div>` +
  (note ? `<div class="note">${esc(note)}</div>` : "") + `</div>`;

/** Grouped bars, hand-rolled SVG. No chart library, nothing loaded off a CDN. */
function bars(rows, keys, colors, height = 120) {
  const w = 1000, gap = 2;
  const peak = Math.max(1, ...rows.map((r) => Math.max(...keys.map((k) => r[k]))));
  const slot = w / rows.length;
  const bw = Math.max(1.5, (slot - gap) / keys.length);
  let out = `<svg viewBox="0 0 ${w} ${height + 22}" width="100%" height="${height + 22}">`;
  rows.forEach((r, i) => keys.forEach((k, j) => {
    const v = r[k];
    if (!v) return;
    const h = Math.max(1.5, (v / peak) * height);
    out += `<rect x="${(i * slot + j * bw).toFixed(1)}" y="${(height - h).toFixed(1)}" ` +
           `width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${colors[j]}"/>`;
  }));
  // Three date labels. Sixty would be noise.
  [0, Math.floor(rows.length / 2), rows.length - 1].forEach((idx) => {
    const anchor = idx === 0 ? "start" : idx === rows.length - 1 ? "end" : "middle";
    out += `<text x="${(idx * slot + slot / 2).toFixed(0)}" y="${height + 16}" font-size="11" ` +
           `fill="currentColor" opacity=".45" text-anchor="${anchor}">${rows[idx].day.slice(5)}</text>`;
  });
  return out + "</svg>";
}

export function render(d, real) {
  const h = d.headline, f = d.funnel, ret = d.retention, st = d.streaks, mo = d.money;
  const net = h.focus_minutes - h.earned_minutes;

  const cards = [
    kpi("Net time off apps", hrs(net),
        "Focus time minus the screen time it paid out. The product's whole claim."),
    kpi("Focus minutes", hrs(h.focus_minutes), `${h.tasks_completed} completed tasks`),
    kpi("Screen time earned", hrs(h.earned_minutes), "Unlocked by finishing tasks"),
    kpi("Tasks created", h.tasks_created.toLocaleString(), `${h.creators} people`),
    kpi("Tasks completed", h.tasks_completed.toLocaleString(),
        `${h.doers} people finished at least one`),
    kpi("Completion rate", `${pct(h.tasks_completed, h.tasks_created)}<small>%</small>`,
        "Of every task ever created"),
    kpi("Accounts", h.accounts.toLocaleString(), `since ${h.first_signup}`),
    kpi("Active (30d)", h.active_30.toLocaleString(), `${h.active_7} in the last 7 days`),
  ].join("");

  const steps = [["Signed up", f.signed_up], ["Finished onboarding", f.onboarded],
    ["Blocked some apps", f.blocked], ["Created a task", f.created],
    ["Completed a task", f.completed], ["Completed 5 or more", f.repeat]];
  const top = Math.max(1, steps[0][1]);
  const frows = steps.map(([l, v]) =>
    `<tr><td>${esc(l)}</td><td class="n">${v}</td><td class="n dim">${pct(v, top)}%</td>` +
    `<td style="width:40%"><div class="track"><div class="bar" style="width:${(v / top * 100).toFixed(1)}%"></div></div></td></tr>`).join("");

  const crows = d.categories.map((c) =>
    `<tr><td>${esc(c.category)}</td><td class="n">${c.created}</td><td class="n">${c.completed}</td>` +
    `<td class="n dim">${pct(c.completed, c.created)}%</td><td class="n">${hrs(c.focus)}</td></tr>`).join("");

  const krows = d.codes.map((k) =>
    `<tr><td><code>${esc(k.code)}</code></td><td class="dim">${esc(k.cohort || "—")}</td>` +
    `<td class="n">${k.uses}/${k.max_uses ?? "∞"}</td>` +
    `<td class="n">${k.grant_days || "permanent"}</td>` +
    `<td class="dim">${esc(k.open_until || "no expiry")}</td></tr>`).join("");

  const erows = d.events.map((e) =>
    `<tr><td><code>${esc(e.event_name)}</code></td><td class="n">${e.n}</td>` +
    `<td class="n dim">${e.users}</td></tr>`).join("");

  const stale = mo.stale_flags
    ? `<div class="card" style="border-color:var(--warn)">
       <div class="lab" style="color:var(--warn)">Data health</div>
       ${mo.stale_flags} profiles still carry sub_active = true with an expiry in the
       past, left from the Stripe era. They are NOT getting free Pro:
       has_own_entitlement() checks the date as well as the flag. They only corrupt
       any count that trusts the flag on its own.</div>` : "";

  const banner = real
    ? `Real users only. ${d.excluded} of our own and test accounts are excluded, along with everything they did.`
    : "Every account, including ours and the test ones. Read these as upper bounds.";

  const gen = new Date(d.generated_at).toISOString().replace("T", " ").slice(0, 16);

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#FAF6EE">
<title>Drift Internal</title><style>${CSS}</style></head><body><div class="wrap">
<h1>Drift, internal</h1>
<div class="toggle">
  <a href="/" class="${real ? "on" : ""}">Real users</a>
  <a href="/?all=1" class="${real ? "" : "on"}">Everyone</a>
</div>
<p class="sub">${esc(banner)}</p>

<h2>Headline</h2>
<div class="grid">${cards}</div>

<h2>Last 60 days</h2>
<div class="card">
  <div class="lab"><span style="color:var(--sage)">■</span> tasks created
    &nbsp; <span style="color:var(--gold)">■</span> completed
    &nbsp; <span style="color:var(--warn)">■</span> signups</div>
  ${bars(d.daily, ["created", "completed", "signups"],
         ["var(--sage)", "var(--gold)", "var(--warn)"])}
</div>

<h2>Funnel</h2>
<div class="card"><div class="scroll"><table><tr><th>Step</th><th class="n">People</th>
<th class="n">Of signups</th><th></th></tr>${frows}</table></div>
<div class="note">Blocking apps is only counted from the build that started recording
it, so it undercounts anyone who set it up before that shipped.</div></div>

<h2>Retention</h2>
<div class="grid">
  ${kpi("Cohort", ret.cohort, "People who created at least one task")}
  ${kpi("Still there day 1", ret.d1, `${pct(ret.d1, ret.cohort)}% of the cohort`)}
  ${kpi("Day 7", ret.d7, `${pct(ret.d7, ret.cohort)}%`)}
  ${kpi("Day 30", ret.d30, `${pct(ret.d30, ret.cohort)}%`)}
</div>

<h2>Habit and access</h2>
<div class="grid">
  ${kpi("On a streak now", st.on_streak, `longest ever ${st.best} days`)}
  ${kpi("Paying", mo.paying, "Live subscription, trials not counted")}
  ${kpi("On trial", mo.trialing, "Free trial running, has not converted yet")}
  ${kpi("Free Pro", mo.overrides, `${mo.redeemed} codes redeemed in total`)}
  ${kpi("AI checked", h.ai_checked, `${h.photo_verified} with photo proof`)}
  ${kpi("Median task", `${Math.round(h.median_task_min || 0)}<small> min</small>`,
        "Half are shorter than this")}
</div>
${stale}

<h2>Categories</h2>
<div class="card"><div class="scroll"><table><tr><th>Category</th><th class="n">Created</th>
<th class="n">Done</th><th class="n">Rate</th><th class="n">Focus</th></tr>${crows}</table></div></div>

<h2>Live codes</h2>
<div class="card"><div class="scroll"><table><tr><th>Code</th><th>Cohort</th><th class="n">Used</th>
<th class="n">Grant days</th><th>Open until</th></tr>${krows}</table></div></div>

<h2>Events recorded</h2>
<div class="card"><div class="scroll"><table><tr><th>Event</th><th class="n">Count</th>
<th class="n">People</th></tr>${erows}</table></div>
<div class="note">If an event you expect is missing, the app is not sending it. That is
how we found screen_view and blocked app selections were dead.</div></div>

<p class="foot">Live from the database at ${esc(gen)} UTC. Reload for current numbers.
Internal only, do not share this link.</p>
</div></body></html>`;
}
