# Do This First

Updated July 29, 2026

## Right now — activates growth infrastructure

**Items 1–4 are DONE** (run against the Drift project `kxsikaymdykepcniozlp` on
2026-07-31). Item 5 is done except the secret.

1. ~~`supabase/admin/analytics_events.sql`~~ ✅ done
2. ~~`supabase/admin/push_tokens.sql`~~ ✅ done
3. ~~`supabase/admin/referrals.sql`~~ ✅ done — also adds `bonus_minutes`, which
   `apply_referral_code()` writes to and nothing previously created
4. ~~`supabase/admin/streaks.sql`~~ ✅ done — triggers now key off `done IS TRUE`,
   matching `completeTaskRow()` in `sync.js`; the original `status = 'completed'`
   column is never written by the app
5. Push functions — **both deployed.** One step left:
   - ~~deploy `send-push`~~ ✅
   - ~~deploy `send-scheduled-pushes`~~ ✅
   - [ ] set `PUSH_SECRET`. **Save the value in a password manager** — Supabase
     secrets cannot be read back, and the cron that calls `send-scheduled-pushes`
     needs it as a `Authorization: Bearer` header. Generate and set in PowerShell:

     ```powershell
     $sb = "$env:APPDATA\npm\node_modules\supabase\node_modules\@supabase\cli-windows-x64\bin\supabase.exe"
     $bytes = New-Object byte[] 32
     [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
     $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
     $hex   # <- copy this into your password manager BEFORE running the next line
     & $sb secrets set PUSH_SECRET=$hex --project-ref kxsikaymdykepcniozlp
     ```

> On this Windows machine, never invoke `supabase` bare or via `npx` from the repo
> root — `PATHEXT` includes `.JS` and `cmd.exe` resolves it to `.\supabase.js`,
> handing the app's own module to Windows Script Host. Use the `$sb` absolute path
> above. Same trap applies to `sync`, `contacts`, `family`, and `places`.

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
