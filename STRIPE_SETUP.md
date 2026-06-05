# Drift — Stripe + Supabase Setup

Follow this once. All secrets stay server-side in Supabase. The app never sees Stripe keys.

**Total time: ~12 minutes.**

---

## 1. Stripe account

1. Go to https://dashboard.stripe.com (in **test mode** while developing)
2. **Products** → New product
   - Name: "Drift Pro"
   - Pricing: recurring, e.g. $4.99 / month
   - Save and copy the **Price ID** (starts with `price_…`)
3. **Developers → API keys**: copy your **Secret key** (starts with `sk_test_…` for test mode)

---

## 2. Supabase SQL — schema additions

Open the Supabase SQL editor and run:

```sql
-- Add subscription tracking to profiles
alter table profiles
  add column if not exists stripe_customer_id text,
  add column if not exists sub_active  boolean default false,
  add column if not exists sub_expires timestamptz;

-- Auto-create profile rows on signup (safer than client-side insert)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    coalesce(lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9]', '', 'g'))
             || lpad(floor(random() * 10000)::text, 4, '0'), 'user'),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- AI usage table (rate limit log)
create table if not exists public.ai_check_usage (
  id bigserial primary key,
  user_id uuid references auth.users not null,
  created_at timestamptz default now() not null
);
create index if not exists ai_check_usage_user_time on public.ai_check_usage (user_id, created_at);
alter table public.ai_check_usage enable row level security;
create policy "users read own usage" on public.ai_check_usage
  for select using (auth.uid() = user_id);
```

---

## 3. Set Supabase Edge Function secrets

```bash
npx supabase login                # one-time
npx supabase link --project-ref kxsikaymdykepcniozlp

npx supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_NEW_KEY
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_YOUR_KEY
npx supabase secrets set STRIPE_PRICE_ID=price_YOUR_PRICE_ID
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_PLACEHOLDER   # filled after step 5
npx supabase secrets set APP_URL=https://drift.app                  # deep link target
npx supabase secrets set IP_HASH_SALT=$(openssl rand -hex 32)       # for trial-abuse hashing
# SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are auto-set
```

---

## 4. Deploy the edge functions

```bash
npx supabase functions deploy verify-task
npx supabase functions deploy evaluate-task
npx supabase functions deploy create-checkout
npx supabase functions deploy claim-trial
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

Also run the v2 schema additions:
```sql
-- Paste from supabase/admin/schema_v2.sql
-- (adds trial tracking, IP log, indexes)
```

And register dev accounts:
```sql
-- Paste from supabase/admin/grant_premium.sql
```

The `--no-verify-jwt` on `stripe-webhook` is required because Stripe (not the user) calls it. The function still verifies Stripe's signature — see `index.ts`.

---

## 5. Add the Stripe webhook

1. Stripe dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://kxsikaymdykepcniozlp.supabase.co/functions/v1/stripe-webhook`
3. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. After creating, copy the **Signing secret** (starts with `whsec_…`)
5. Update the secret:
   ```bash
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_THE_ACTUAL_VALUE
   npx supabase functions deploy stripe-webhook --no-verify-jwt
   ```

---

## 6. Testing the flow

1. In the app → sign in → tap profile icon → "Upgrade to Pro"
2. You're sent to a real Stripe Checkout page (use test card `4242 4242 4242 4242`, any future expiry, any CVC)
3. After success Stripe fires the webhook → `profiles.sub_active = true`
4. The app's `useSubscription` listens to real-time updates and unlocks AI features within ~1 second

For local testing of the webhook:
```bash
stripe login
stripe listen --forward-to https://kxsikaymdykepcniozlp.supabase.co/functions/v1/stripe-webhook
```

---

## 7. Going live

When ready for production:
- Switch Stripe dashboard to **Live mode**
- Create the same product/price in Live mode
- Update the secrets with `sk_live_…` and the live `price_…` and live webhook secret

---

## Security notes

- **Server is source of truth.** The app reads `sub_active` from `profiles`; clients cannot grant themselves access.
- **AI edge functions check `sub_active`** before calling OpenAI — server-side gate.
- **Stripe key never leaves Supabase.** All Stripe SDK calls happen in edge functions.
- **Webhook signature is verified** so a malicious actor cannot fake `subscription.created` events.
- **Service-role key only used inside edge functions**, never shipped to clients.
