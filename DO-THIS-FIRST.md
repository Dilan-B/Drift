# Do This First

*Updated July 29, 2026*

I built **analytics, push notifications, referrals, SEO pages, share cards, ASO copy, and ready-to-post content** overnight. Then I **wired the ShareCard into ProfileScreen** with live stats fetching and referral code attribution in the share message.

Below is everything you need to do to activate it all.

---

## Do right now — activates growth infrastructure

- [ ] **Run analytics SQL in Supabase** `SQL`
  Open Supabase SQL editor → paste contents of `supabase/admin/analytics_events.sql` → Run. Creates the event tracking table.

- [ ] **Run push tokens SQL in Supabase** `SQL`
  Paste `supabase/admin/push_tokens.sql` into SQL editor → Run. Stores Expo push tokens for remote notifications.

- [ ] **Run referrals SQL in Supabase** `SQL`
  Paste `supabase/admin/referrals.sql` → Run. Adds referral codes to profiles, creates referral_events table, auto-generates codes for existing users. **Required for the new Share & Invite button in Profile to show referral links.**

- [ ] **Run streaks SQL in Supabase** `SQL`
  Paste `supabase/admin/streaks.sql` → Run. Adds streak columns to profiles with auto-update triggers and backfills existing data. **Required for the Share Card to show streak counts.**

- [ ] **Deploy push notification functions** `DEPLOY`
  Run these in terminal:
  ```bash
  npx supabase functions deploy send-push --project-ref kxsikaymdykepcniozlp
  npx supabase functions deploy send-scheduled-pushes --project-ref kxsikaymdykepcniozlp
  npx supabase secrets set PUSH_SECRET=$(openssl rand -hex 32) --project-ref kxsikaymdykepcniozlp
  ```

---

## Do today — App Store & distribution

- [ ] **Update App Store listing with ASO copy** `APP STORE`
  Open `marketing/aso-keywords.md`. Copy the title, subtitle, keywords (100 chars), description, and What's New into App Store Connect.

- [ ] **Submit build for review** `APP STORE`
  Xcode Cloud Build 5 has the overnight growth code. The Share & Invite feature is newer — trigger a new Xcode Cloud build from main to include it, or submit Build 5 now and ship share in 1.1.5.

- [ ] **Update age rating for social media** `APP STORE`
  App Store Connect warning: "Update Your Age Ratings Responses about Social Media" by September 7. Go to App Information → Age Rating and answer the new questions.

- [ ] **Post to r/productivity** `POST`
  Copy from `marketing/ready-to-post/reddit-r-productivity.md`. Post between 8-10 AM EST. Engage with every comment for 2+ hours.

---

## This week — momentum

- [ ] **Post to r/nosurf (Day 2)** `POST`
  Use `marketing/ready-to-post/reddit-r-nosurf.md`. Focus on the addiction/recovery story.

- [ ] **Post to r/Parenting (Day 3)** `POST`
  Use `marketing/ready-to-post/reddit-r-parenting.md`. Parent perspective.

- [ ] **Post Twitter/X thread** `POST`
  Use `marketing/ready-to-post/twitter-thread.md`. 9-tweet builder story thread.

- [ ] **Record first TikTok** `POST`
  Scripts in `marketing/ready-to-post/tiktok-scripts.md`. Start with Video 1: "I built an app that blocks TikTok."

- [ ] **Set up Product Hunt launch** `PREP`
  Follow checklist in `marketing/product-hunt-launch.md`. Create maker account, upload screenshots, schedule for next Tuesday 12:01 AM PT.

---

## What I built (all pushed to main)

- **analytics.js** — event tracking with batched Supabase inserts
- **notifications.js** — added registerForPushNotifications()
- **referrals.js** — referral codes + 15-min bonus rewards
- **contacts.js** — invite flow now includes referral code
- **ShareCard.jsx** — shareable 9:16 stats card with referral code in share message
- **ProfileScreen.jsx** — new "Share & Invite" row opens ShareCard with live stats + referral code
- **Drift.jsx** — wired analytics + push into app boot
- **send-push/** — edge function for remote push via Expo API
- **send-scheduled-pushes/** — automated streak/inactivity/motivation pushes
- **docs/*.html** — SEO pages (parents, students, reduce-screen-time blog)
- **marketing/** — ASO keywords, Product Hunt prep, outreach targets, ready-to-post content
- **supabase/admin/*.sql** — analytics, push tokens, referrals, streaks, dashboard queries
