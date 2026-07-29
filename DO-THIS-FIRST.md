# Do This First

Updated July 29, 2026

## Right now — activates growth infrastructure

> ⚠️ **Blocked on Riaan.** `supabase/admin/` is gitignored (`.gitignore:20`) and no
> file under it is tracked in git, so none of the four SQL files below were
> pushed — they exist only on the machine that wrote them. Dilan's checkout has
> just `diagnose_recurring_duplicates.sql` and `schema_v5_recurring_template_id.sql`.
> Send the four files directly (they must not be committed), or paste them into
> the Supabase SQL editor yourself. Item 5 depends on step 2 — `send-push` writes
> to `push_tokens`, so deploying before that table exists fails at runtime.

1. Run `supabase/admin/analytics_events.sql` in Supabase SQL editor. Creates the event tracking table.
2. Run `supabase/admin/push_tokens.sql` in Supabase SQL editor. Stores Expo push tokens.
3. Run `supabase/admin/referrals.sql` in Supabase SQL editor. Adds referral codes to profiles, creates referral_events table. Required for Share & Invite in Profile.
4. Run `supabase/admin/streaks.sql` in Supabase SQL editor. Adds streak columns with auto-update triggers. Required for Share Card stats.
5. Deploy push functions:
   npx supabase functions deploy send-push --project-ref kxsikaymdykepcniozlp
   npx supabase functions deploy send-scheduled-pushes --project-ref kxsikaymdykepcniozlp
   npx supabase secrets set PUSH_SECRET=$(openssl rand -hex 32) --project-ref kxsikaymdykepcniozlp

## Today — App Store & distribution

6. Update App Store listing with ASO copy from `marketing/aso-keywords.md` (title, subtitle, keywords, description, What's New). The description now includes the Terms of Use and Privacy Policy links — do not drop them, their absence is what auto-rejected the last two submissions.
7. ~~Submit build 5.~~ **Do NOT submit build 5** — it predates the App Store review fixes and will be rejected a fourth time. Merged into main on Jul 29 (commit `fd8eb90`): Sign in with Apple now renders (Guideline 4.8), the rating prompt moved out of onboarding (5.6.3), and the app.json/native version mismatch that locked everyone out of TestFlight is fixed. Trigger a **fresh Xcode Cloud build from main**, bump the build number to 6+, verify the checklist in `marketing/app-store-handoff/README.md` §A3, then submit.
8. Update age rating in App Store Connect (deadline Sept 7). App Information → Age Rating.

> Items 9–14 drive traffic to a listing that is still rejected. Hold them until
> the build from item 7 is **accepted**, then run them in order.

9. Post to r/productivity using `marketing/ready-to-post/reddit-r-productivity.md`. Post 8-10 AM EST, engage with comments.

## This week — momentum

10. Post to r/nosurf using `marketing/ready-to-post/reddit-r-nosurf.md`.
11. Post to r/Parenting using `marketing/ready-to-post/reddit-r-parenting.md`.
12. Post Twitter/X thread using `marketing/ready-to-post/twitter-thread.md`.
13. Record first TikTok using scripts in `marketing/ready-to-post/tiktok-scripts.md`.
14. Set up Product Hunt launch using checklist in `marketing/product-hunt-launch.md`.

## What was built (all on main)

analytics.js, notifications.js, referrals.js, contacts.js, ShareCard.jsx, ProfileScreen.jsx (Share & Invite row), Drift.jsx (analytics + push wired in), send-push and send-scheduled-pushes edge functions, docs SEO pages (parents, students, reduce-screen-time), marketing content (ASO, Product Hunt, outreach targets, 3 Reddit posts, Twitter thread, 4 TikTok scripts), supabase/admin SQL files (analytics, push tokens, referrals, streaks, dashboard queries).
