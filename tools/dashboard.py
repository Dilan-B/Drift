#!/usr/bin/env python3
"""
tools/dashboard.py — internal Drift metrics, as a self-contained HTML page.

    python3 tools/dashboard.py             # everyone, us included
    python3 tools/dashboard.py --real       # exclude our own and test accounts
    python3 tools/dashboard.py --no-open

Runs tools/dashboard.sql through the Supabase CLI (service role, via the
linked project) and bakes the numbers into the page. Nothing in the output
talks to the network: no CDN, no keys, no API calls. That is deliberate —
a page that could fetch live data would need a service-role key inside it,
and this file gets AirDropped and emailed.

The output is gitignored. Regenerate it, never edit it.
"""
import json
import subprocess
import sys
import webbrowser
from datetime import datetime
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dashboard.html"

# Our own accounts and the test ones. Six of them hold half of every task ever
# created, so a page that counts them is a page about us, not about users.
# Matched on email, which is the only handle the auth table gives us.
TEAM_LIKE = ["%sanghani%", "%dilan%", "%ridilabs%", "%getdriftapp%",
             "%test%", "%example.com"]
EXCL_SQL = "email ilike any(array[" + ",".join(f"'{p}'" for p in TEAM_LIKE) + "])"

# Drift's palette, so an internal page still looks like the product.
CSS = """
:root{--paper:#FAF6EE;--card:#FFFDF8;--ink:#1D2B22;--mid:#5C6B62;--faint:#9AA8A0;
--line:#E4DED1;--sage:#4B7F63;--deep:#2F5D46;--warn:#B5564B;--gold:#C08B3E}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--paper:#12180F;
--card:#19211A;--ink:#EDE7DA;--mid:#A3B0A6;--faint:#6D7C72;--line:#2A342C;
--sage:#7FB894;--deep:#9ED0AE}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 -apple-system,
BlinkMacSystemFont,"SF Pro Text",Segoe UI,sans-serif;padding:32px 16px 80px}
.wrap{max-width:1080px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.4px}
h2{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--sage);
margin:44px 0 14px;font-weight:600}
.sub{color:var(--mid);font-size:13px;margin:0 0 8px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(168px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.kpi{font-size:30px;font-weight:600;letter-spacing:-1px;line-height:1.1}
.kpi small{font-size:13px;font-weight:400;color:var(--mid);letter-spacing:0}
.lab{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--faint);
margin-bottom:7px}
.note{font-size:12px;color:var(--mid);margin-top:6px;line-height:1.45}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;
color:var(--faint);font-weight:600;padding:0 10px 8px}
td{padding:8px 10px;border-top:1px solid var(--line)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:9px;border-radius:5px;background:var(--sage);min-width:2px}
.track{background:var(--line);border-radius:5px;overflow:hidden}
.dim{color:var(--faint)}
.foot{margin-top:48px;color:var(--faint);font-size:12px;border-top:1px solid var(--line);
padding-top:14px}
"""


def q(real):
    """Run the metrics query. The CLI prints a banner line before the JSON."""
    sql = (ROOT / "tools" / "dashboard.sql").read_text().replace(
        "{{EXCL}}", EXCL_SQL if real else "false")
    tmp = ROOT / "tools" / ".dashboard.run.sql"
    tmp.write_text(sql)
    try:
        r = subprocess.run(
            ["supabase", "db", "query", "--linked", "--file", str(tmp.relative_to(ROOT))],
            cwd=ROOT, capture_output=True, text=True,
        )
    finally:
        tmp.unlink(missing_ok=True)
    out = r.stdout
    if "{" not in out:
        sys.exit(f"query failed:\n{r.stdout}\n{r.stderr}")
    doc = json.loads(out[out.index("{"):])
    if "rows" not in doc:
        sys.exit(f"query failed:\n{out}")
    return doc["rows"][0]["payload"]


def hrs(m):
    """17379 -> '289 h'. Minutes stop being legible in the thousands."""
    return f"{round(m/60):,} h" if m >= 120 else f"{m:,} min"


def kpi(label, value, note=""):
    n = f'<div class="note">{escape(note)}</div>' if note else ""
    return (f'<div class="card"><div class="lab">{escape(label)}</div>'
            f'<div class="kpi">{value}</div>{n}</div>')


def sparkbars(rows, keys, colors, height=120):
    """Grouped bar chart, hand-rolled SVG. No chart library, no CDN."""
    w, gap = 1000, 2
    peak = max([max(r[k] for k in keys) for r in rows] + [1])
    n = len(rows)
    slot = w / n
    bw = max(1.5, (slot - gap) / len(keys))
    out = [f'<svg viewBox="0 0 {w} {height+22}" width="100%" height="{height+22}">']
    for i, r in enumerate(rows):
        for j, k in enumerate(keys):
            v = r[k]
            if not v:
                continue
            h = max(1.5, v / peak * height)
            x = i * slot + j * bw
            out.append(f'<rect x="{x:.1f}" y="{height-h:.1f}" width="{bw:.1f}" '
                       f'height="{h:.1f}" rx="1" fill="{colors[j]}"/>')
    # Label first, middle and last day only; 60 date labels is noise.
    for idx in (0, n // 2, n - 1):
        anchor = "start" if idx == 0 else ("end" if idx == n - 1 else "middle")
        out.append(f'<text x="{idx*slot+slot/2:.0f}" y="{height+16}" font-size="11" '
                   f'fill="currentColor" opacity=".45" text-anchor="{anchor}">'
                   f'{rows[idx]["day"][5:]}</text>')
    out.append("</svg>")
    return "".join(out)


def build(d, real):
    h, f = d["headline"], d["funnel"]
    focus, earned = h["focus_minutes"], h["earned_minutes"]
    net = focus - earned
    created, completed = h["tasks_created"], h["tasks_completed"]
    rate = round(completed / created * 100) if created else 0
    ret = d["retention"]

    cards = "".join([
        kpi("Net time off apps", hrs(net),
            "Focus time minus the screen time it paid out. The product's whole claim."),
        kpi("Focus minutes", hrs(focus), f"{completed:,} completed tasks"),
        kpi("Screen time earned", hrs(earned), "Unlocked by finishing tasks"),
        kpi("Tasks created", f"{created:,}", f"{h['creators']} people"),
        kpi("Tasks completed", f"{completed:,}", f"{h['doers']} people finished at least one"),
        kpi("Completion rate", f"{rate}<small>%</small>", "Of every task ever created"),
        kpi("Accounts", f"{h['accounts']:,}", f"since {h['first_signup']}"),
        kpi("Active (30d)", f"{h['active_30']:,}", f"{h['active_7']} in the last 7 days"),
    ])

    # Funnel. Each row is a share of signups, so the drop-offs are visible.
    steps = [("Signed up", f["signed_up"]), ("Finished onboarding", f["onboarded"]),
             ("Blocked some apps", f["blocked"]), ("Created a task", f["created"]),
             ("Completed a task", f["completed"]), ("Completed 5 or more", f["repeat"])]
    top = max(steps[0][1], 1)
    frows = "".join(
        f'<tr><td>{escape(l)}</td><td class="n">{v:,}</td>'
        f'<td class="n dim">{round(v/top*100)}%</td>'
        f'<td style="width:45%"><div class="track"><div class="bar" '
        f'style="width:{v/top*100:.1f}%"></div></div></td></tr>' for l, v in steps)

    crows = "".join(
        f'<tr><td>{escape(c["category"])}</td><td class="n">{c["created"]:,}</td>'
        f'<td class="n">{c["completed"]:,}</td>'
        f'<td class="n dim">{round(c["completed"]/c["created"]*100) if c["created"] else 0}%</td>'
        f'<td class="n">{hrs(c["focus"])}</td></tr>' for c in d["categories"])

    krows = "".join(
        f'<tr><td><code>{escape(k["code"])}</code></td>'
        f'<td class="dim">{escape(k["cohort"] or "—")}</td>'
        f'<td class="n">{k["uses"]}/{k["max_uses"] if k["max_uses"] is not None else "∞"}</td>'
        f'<td class="n">{k["grant_days"] or "permanent"}</td>'
        f'<td class="dim">{k["open_until"] or "no expiry"}</td></tr>' for k in d["codes"])

    erows = "".join(
        f'<tr><td><code>{escape(e["event_name"])}</code></td>'
        f'<td class="n">{e["n"]:,}</td><td class="n dim">{e["users"]}</td></tr>'
        for e in d["events"])

    st, mo = d["streaks"], d["money"]
    gen = datetime.fromisoformat(d["generated_at"]).strftime("%d %b %Y, %H:%M UTC")
    banner = (
        f"Real users only. {d['excluded']} of our own and test accounts are "
        f"excluded, along with everything they did."
        if real else
        "Every account, including ours and the test ones. Half of all tasks "
        "ever created came from six team accounts, so read these as upper "
        "bounds, or rerun with --real."
    )

    flag = " --real" if real else ""
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drift Internal</title><style>{CSS}</style></head><body><div class="wrap">
<h1>Drift, internal</h1>
<p class="sub">{banner}</p>

<h2>Headline</h2>
<div class="grid">{cards}</div>

<h2>Last 60 days</h2>
<div class="card">
  <div class="lab"><span style="color:var(--sage)">■</span> tasks created
    &nbsp; <span style="color:var(--gold)">■</span> completed
    &nbsp; <span style="color:var(--warn)">■</span> signups</div>
  {sparkbars(d['daily'], ['created','completed','signups'],
             ['var(--sage)','var(--gold)','var(--warn)'])}
</div>

<h2>Funnel</h2>
<div class="card"><table><tr><th>Step</th><th class="n">People</th>
<th class="n">Of signups</th><th></th></tr>{frows}</table>
<div class="note">Blocking apps is only counted from the build that started
recording it, so it undercounts anyone who set it up before that shipped.</div></div>

<h2>Retention</h2>
<div class="grid">
  {kpi("Cohort", f"{ret['cohort']:,}", "People who created at least one task")}
  {kpi("Still there day 1", f"{ret['d1']:,}", f"{round(ret['d1']/ret['cohort']*100) if ret['cohort'] else 0}% of the cohort")}
  {kpi("Day 7", f"{ret['d7']:,}", f"{round(ret['d7']/ret['cohort']*100) if ret['cohort'] else 0}%")}
  {kpi("Day 30", f"{ret['d30']:,}", f"{round(ret['d30']/ret['cohort']*100) if ret['cohort'] else 0}%")}
</div>

<h2>Habit and access</h2>
<div class="grid">
  {kpi("On a streak now", f"{st['on_streak']:,}", f"longest ever {st['best']} days")}
  {kpi("Paying", f"{mo['subscribers']:,}", "RevenueCat says the subscription is live")}
  {kpi("Free Pro", f"{mo['overrides']:,}", f"{mo['redeemed']} codes redeemed in total")}
  {kpi("AI checked", f"{h['ai_checked']:,}", f"{h['photo_verified']} with photo proof")}
  {kpi("Median task", f"{int(h['median_task_min'] or 0)}<small> min</small>", "Half are shorter than this")}
  {kpi("Total XP", f"{h['xp']:,}")}
</div>

<h2>Categories</h2>
<div class="card"><table><tr><th>Category</th><th class="n">Created</th>
<th class="n">Done</th><th class="n">Rate</th><th class="n">Focus</th></tr>{crows}</table></div>

<h2>Live codes</h2>
<div class="card"><table><tr><th>Code</th><th>Cohort</th><th class="n">Used</th>
<th class="n">Grant days</th><th>Open until</th></tr>{krows}</table></div>

<h2>Events recorded</h2>
<div class="card"><table><tr><th>Event</th><th class="n">Count</th>
<th class="n">People</th></tr>{erows}</table>
<div class="note">If an event you expect is missing, the app is not sending it.
That is how we found screen_view and blocked app selections were dead.</div></div>

<p class="foot">Generated {gen} from the live database by
<code>tools/dashboard.py{flag}</code>. Internal only: run it again for fresh numbers,
and do not edit this file by hand.</p>
</div></body></html>"""


if __name__ == "__main__":
    real = "--real" in sys.argv
    OUT.write_text(build(q(real), real))
    print(f"wrote {OUT}")
    if "--no-open" not in sys.argv:
        webbrowser.open(OUT.as_uri())
