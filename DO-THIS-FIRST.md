# Do This First

Updated July 29, 2026

## Right now — activates growth infrastructure

1. Run `supabase/admin/analytics_events.sql` in Supabase SQL editor. Creates the event tracking table.
2. Run `supabase/admin/push_tokens.sql` in Supabase SQL editor. Stores Expo push tokens.
3. Run `supabase/admin/referrals.sql` in Supabase SQL editor. Adds referral codes to profiles, creates referral_events table. Required for Share & Invite in Profile.
4. Run `supabase/admin/streaks.sql` in Supabase SQL editor. Adds streak columns with auto-update triggers. Required for Share Card stats.
5. Deploy push functions:
   npx supabase functions deploy send-push --project-ref kxsikaymdykepcniozlp
   npx supabase functions deploy send-scheduled-pushes --project-ref kxsikaymdykepcniozlp
   npx supabase secrets set PUSH_SECRET=$(openssl rand -hex 32) --project-ref kxsikaymdykepcniozlp

## Today — App Store & distribution

6. Update App Store listing with ASO copy from `marketing/aso-keywords.md` (title, subtitle, keywords, description, What's New).
7. Submit build for review. Build 5 from Xcode Cloud has the overnight code. For the Share & Invite feature, trigger a new build from main first — or ship it in 1.1.5.
8. Update age rating in App Store Connect (deadline Sept 7). App Information → Age Rating.
9. Post to r/productivity using `marketing/ready-to-post/reddit-r-productivity.md`. Post 8-10 AM EST, engage with comments.

## This week — momentum

10. Post to r/nosurf using `marketing/ready-to-post/reddit-r-nosurf.md`.
11. Post to r/Parenting using `marketing/ready-to-post/reddit-r-parenting.md`.
12. Post Twitter/X thread using `marketing/ready-to-post/twitter-thread.md`.
13. Record first TikTok using scripts in `marketing/ready-to-post/tiktok-scripts.md`.
14. Set up Product Hunt launch using checklist in `marketing/product-hunt-launch.md`.

## What was built (all on main)

analytics.js, notifications.js, referrals.js, contacts.js, ShareCard.jsx, ProfileScreen.jsx (Share & Invite row), Drift.jsx (analytics + push wired in), send-push and send-scheduled-pushes edge functions, docs SEO pages (parents, students, reduce-screen-time), marketing content (ASO, Product Hunt, outreach targets, 3 Reddit posts, Twitter thread, 4 TikTok scripts), supabase/admin SQL files (analytics, push tokens, referrals, streaks, dashboard queries).
