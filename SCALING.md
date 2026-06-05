# Drift — Scaling Architecture

How the backend handles load. Last updated 2026-06-05.

## What's protecting us from overload

### Edge function rate limits (server-enforced, can't be bypassed)
| Endpoint | Per user | Per IP |
|---|---|---|
| `verify-task`   | 5/hour, 20/day | – |
| `evaluate-task` | 30/hour, 200/day | – |
| `claim-trial`   | 1 per lifetime | 3/10min, 1 every 30 days |
| `create-checkout` | n/a | (Stripe handles) |
| `stripe-webhook` | n/a | (signature-verified) |

Excess requests return HTTP 429 immediately — no DB write, no OpenAI call.

### Body-size guards
- Image proofs hard-capped at ~375 KB (`MAX_IMAGE_BYTES`)
- Proof text capped at 1,000 chars
- Total request body capped at 800 KB
- Rejects oversized requests via `content-length` header BEFORE buffering

### Subscription check cache
Each edge function instance caches `sub_active` for 60 seconds per user.
- Cold start: 1 DB query per user per minute (worst case)
- Warm: cached → 0 DB queries for that user inside the window
- Cache bounded to 5,000 entries (cleared if exceeded) → constant memory

Without the cache: 1 DB query per AI call. With: ~1 query per user per minute regardless of how many calls they make.

### Database indexes (`schema_v2.sql`)
- `profiles_sub_active` (partial — only true rows) — webhook updates
- `screen_time_user_date` — friends list queries
- `ai_usage_user_recent` — rate-limit lookups
- `trial_ip_log_hash_time` — trial abuse check
- `friendships_user_status` / `friendships_friend_stat` — friends queries

### Real-time subscriptions
Each signed-in user opens 1 real-time channel (subscription status updates). Supabase comfortably handles 10K+ concurrent channels per project on the free tier and >100K on Pro.

If you grow past that:
- Move the subscription check to a polling model (every 60s) instead of real-time
- Or only open the channel when the user views the paywall

### Stripe webhook
Idempotent — re-running the same event has no extra effect.
Stripe retries failed deliveries automatically (up to 3 days).

## What to add when you hit real scale

### At ~10K MAU
- Enable **Postgres connection pooling (Supavisor)** — should be on by default in newer Supabase projects
- Migrate the rate-limit log to Redis (Upstash has a free tier)
  - Right now we count rows in `ai_check_usage` per call — fine for hundreds of req/s, slows past that

### At ~100K MAU
- Add a CDN for the React Native bundle (Expo OTA updates already use CloudFront)
- Move subscription cache to Redis with pub/sub for instant invalidation
- Promote Supabase project to "Pro" tier (more CPU, more connections)

### At ~1M MAU
- Shard the IP-hash table by hash prefix
- Move `screen_time` to a separate database (analytics workload differs from auth workload)
- Background-process AI evaluations via a queue (currently synchronous)

## Things we already do right
- ✅ JWT auth (no session table to scale)
- ✅ Row Level Security (Postgres enforces, no app-layer checks needed)
- ✅ Edge functions auto-scale (Deno Deploy)
- ✅ Idempotent webhooks
- ✅ No raw IPs stored (hashed, gives us abuse detection without PII)
- ✅ All AI calls server-side (rate limits can't be bypassed by reverse-engineering the app)
