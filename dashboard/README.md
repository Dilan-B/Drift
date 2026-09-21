# Drift internal dashboard

Live metrics from the production database, served as one page, behind a
password, and readable on a phone. Deployed to Vercel.

It is always current: every page load calls `public.internal_dashboard()` and
renders the answer. Nothing is precomputed, so there is no build to rerun and
no snapshot to go stale. Pull to refresh.

## Layout

    api/index.js      auth, one database call, render. The whole server.
    lib/render.js     data in, HTML out. No database, no keys, no CDN.
    scripts/preview   renders the layout from invented numbers

## Deploying

This repository is PUBLIC. Nothing in this folder may contain a key or a real
number; both live in Vercel's environment variables instead.

1. `npm i -g vercel && vercel login`
2. From this folder: `vercel` — link it as a NEW project, and when it asks for
   the root directory, accept this folder.
3. Set four environment variables, in Production and Preview:

       SUPABASE_URL                 https://kxsikaymdykepcniozlp.supabase.co
       SUPABASE_SERVICE_ROLE_KEY    Supabase → Project Settings → API → service_role
       DASH_USER                    whatever you like
       DASH_PASS                    long and random, not a password used elsewhere

   `vercel env add SUPABASE_SERVICE_ROLE_KEY production`, and so on.
4. `vercel --prod`
5. Open the URL, sign in once, then Share → Add to Home Screen.

## The service-role key

That key bypasses every row-level security policy in the project. It is why
this app is a server and not a static page: a static page would have to carry
the key to the browser, where anyone could read it and then read every user's
data.

So: it goes in Vercel's environment variables and nowhere else. Never in this
folder, never in the HTML, never in a commit, never in a screenshot. If it is
ever exposed, rotate it in the Supabase dashboard immediately — that is the
only fix, because a leaked key cannot be un-leaked.

The database function it calls is `security definer` and revoked from `anon`
and `authenticated`, so the key is the only way in, and it returns aggregates
only: no user id, email or task title crosses the wire.

## The password

Basic auth, checked with a timing-safe comparison, and the app refuses to serve
anything at all if `DASH_USER` or `DASH_PASS` is unset. If Vercel offers
Deployment Protection on the plan, turn that on as well. Two locks are better
than one on a page showing revenue.

## Local preview

    npm install
    npm run preview        # writes preview.html from invented numbers

`preview.html` is gitignored. To see real numbers locally, use
`python3 ../tools/dashboard.py --real` in the repo root, which goes through the
Supabase CLI and needs no key of its own.
