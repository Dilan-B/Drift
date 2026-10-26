# Drift Privacy Policy

**Effective: October 25, 2026**

This policy explains what the Drift app collects, why, who it goes to, how long we keep it, and what you can do about it. We've tried to keep it short and exact. If anything here is unclear, email **driftappcontact@gmail.com**.

Drift is not a healthcare provider and is not covered by HIPAA. We hold ourselves to the commitments below instead.

## What we collect

**Account**
- Your email address (sign-in and account recovery), or the identifier Apple or Google gives us if you sign in with them.
- The username you pick and, if you add one, a profile photo.
- Your password, stored only as a salted hash by our authentication provider. We never see it.

**What you do in Drift**
- Tasks you create: title, duration, category, when you completed them, and any written proof you add.
- Your screen-time balance, credits, XP, level and streak.
- Friends you add, and challenges you send or receive.
- The answers you give during setup (which daily tasks to start with, and how strict you want verification to be).
- Recurring tasks, blocked-hours schedules and action plans you set up.

**AI Check (optional, Pro and free-tier verification)**
- When you ask Drift to verify a task, we send the task title, your written proof and, if you attach one, a photo or a handful of still frames from a short video to OpenAI through our server.
- **The photo or video is not stored** by us. We keep a short text description of what the AI saw, and its verdict, on the task so you can answer a follow-up question and so the result can be reviewed.
- OpenAI processes this under its API terms: it does not use API data to train its models, and may keep it for up to 30 days to monitor for abuse before deleting it.
- **Children's accounts never use AI Check.** Our servers refuse it.

**Product analytics**
- Simple usage events, such as "task completed" or "app opened", with your user ID, platform, OS version and app version. They're stored in our own database, never sent to an analytics or advertising company, and used only to understand how Drift is used.
- **Children's accounts are never tracked.**

**Technical**
- A push-notification token for your device, and the app language it uses, so we can send the notifications you've allowed.
- A one-way hash of your IP address when you redeem a code or start a trial, to stop abuse.

## What stays on your phone

These never leave your device:
- **Apple Screen Time selections.** Apple gives Drift only opaque tokens for the apps you pick. We can't see which apps they are, or how you use them.
- **Location.** Places you save and arrival detection run on the device. Coordinates are never uploaded.
- **Calendar and Reminders.** If you turn on calendar sync, today's events are read on the device to create tasks. Nothing is uploaded except the tasks you choose to keep.
- **Motion data** for Lockbox, sleep guard and exercise counting.
- **Pose detection** during exercise challenges runs on the device. No camera image is uploaded for it.
- **NFC tag ID** for the sleep guard.

**Contacts (optional).** If you use "Find friends from contacts", contact email addresses are normalised and SHA-256 hashed on your device. Only the hashes are sent, to match them against Drift users. We don't store them.

## What we don't do

- We don't sell or rent personal data, or "share" it for cross-context behavioural advertising.
- There are no advertising SDKs, data brokers, third-party analytics or crash reporters in Drift.
- We don't collect your precise location, Health app data, contacts' names or phone numbers, or your browsing.

## Who receives data

We use these service providers. Each processes data only to run Drift, under contracts that require them to keep it confidential and secure:

| Provider | What for | What it receives |
|---|---|---|
| Supabase (USA) | Database, sign-in, file storage, server functions | Everything stored in your account |
| OpenAI (USA) | AI Check and task valuation | Task title, written proof, proof photo or frames |
| RevenueCat (USA) | Subscription status | Your Drift account ID and Apple's receipt, not your tasks |
| Apple | In-app purchases, Sign in with Apple, push delivery | Purchase, sign-in and notification data |
| Expo (USA) | Push notification delivery | Push token and the notification text |
| Google | Google sign-in (if you use it) | Sign-in data |

We disclose data to authorities only when legally required, for example a valid court order.

## What other people can see

- Other Drift users can see your **username, profile photo and level**.
- **Friends** you've added can also see today's screen-time minutes, your streak, and challenges between you.
- Your tasks, proof and AI results are visible only to you. For a child account, they're also visible to the parent.

## Children and families

Personal Drift accounts are for people 13 and older. Children under 13 may use Drift only through a **Family** account that a parent sets up. This section is our notice to parents under the Children's Online Privacy Protection Act (COPPA).

**Parental consent first.** A family code doesn't work until the parent has read our notice in the app and agreed to it. We verify consent through the parent's Drift Family purchase. Apple processes it as a monetary transaction and notifies the account holder. We record when consent was given and which version of the notice it was for, and we ask again if that notice changes materially.

**What we collect from a child**
- The first name or nickname they type when joining.
- Tasks the parent assigns, and whether they're done.
- Their screen-time balance and the app categories the parent allows.
- Requests they send the parent to allow an app.
- A push-notification token.

**What we don't collect from a child:** email, phone number, password, photos, video, location, contacts, birthday, or usage analytics. Children's accounts never use AI Check, so nothing a child does is sent to OpenAI. Which apps a child uses stays on their phone.

**Why.** Only to provide the features the parent uses: assigning and approving tasks, and unlocking screen time on the child's phone. We don't use children's data for advertising, profiling or AI training, and we never make it public.

**Who receives it.** Only Supabase (storage) and Apple and Expo (notification delivery), as service providers. No other third parties.

**Parents' rights.** In the parent's Drift app, a parent can at any time:
- **Review** what Drift holds about each child: tap **Data** next to the child's name.
- **Delete** a child's data: Data → Delete.
- **Withdraw consent**: Profile → *Withdraw consent and delete kids' data*. This deletes every child's data and stops all further collection.

Parents can also email driftappcontact@gmail.com.

**Retention.** A child's data is kept only while the child uses Drift. It's deleted when the parent removes the child, withdraws consent or deletes their own account, and automatically after 18 months with no activity.

## How long we keep data

| Data | Kept for |
|---|---|
| Your account and the things you've created | Until you delete your account |
| Product analytics events | 13 months |
| AI Check usage records | 90 days |
| Push tokens | Until 9 months after the device last checks in |
| A child's data | See "Children and families" above |
| Subscription event records (opaque account ID, product, dates) | As long as needed for billing, tax and dispute obligations |

These limits are enforced automatically every night.

## Your rights and choices

- **Delete your account in the app:** Profile → *Delete account*. This permanently erases your profile, tasks, history, friendships, challenges, analytics and profile photo. It also deletes any children in your family, and revokes Sign in with Apple. Deleting your account doesn't cancel an Apple subscription; cancel it in iPhone Settings → Apple ID → Subscriptions.
- **Access, correction, export or objection:** email driftappcontact@gmail.com from your account's email address. We reply within 30 days.
- **Permissions:** location, calendar, contacts, camera, motion and notifications are all optional. You can turn each one off in iPhone Settings at any time.

**California (CCPA/CPRA) and other US states.** You have the right to know, delete, correct and port your personal information, and to not be discriminated against for using these rights. We don't sell or share personal information, and we don't use sensitive personal information to infer characteristics about you. To make a request, use the email above; an authorised agent may make one for you.

**Consumer health data (Washington, Nevada and similar laws).** Some of what you do in Drift, such as exercise tasks, workout challenges and sleep-guard results, could be treated as consumer health data. We collect it only to provide the feature you're using, with your consent when you choose that feature. We don't sell it or share it with third parties beyond the providers listed above, and you can review or delete it, or withdraw consent, as described in this policy. We never geofence health-care facilities.

**EEA, UK and Switzerland (GDPR).** We process your data to provide the service you asked for (contract), to measure and improve it and prevent abuse (legitimate interests), and with your consent for optional features such as contacts matching and calendar sync. You may withdraw consent at any time. Data is processed in the United States under Standard Contractual Clauses. You have the rights of access, rectification, erasure, restriction, portability and objection, and the right to complain to your local data-protection authority.

## Security

- All traffic is encrypted in transit (TLS 1.2+), and data is encrypted at rest.
- Row-level security means one account can never read another's private data. The parent–child relationship is the only exception.
- Sign-in tokens on your phone are encrypted with a key held in the iOS Keychain.
- We keep a written information-security programme, review risks at least once a year, and will notify you and the relevant authorities of a breach as the law requires.

## Changes

If we make a material change, we'll show the new version in the app before it applies. Parents will be asked for consent again if the change affects children's data. The date at the top is the latest revision.

## Contact

Drift, **driftappcontact@gmail.com**. This covers privacy, deletion, parental requests and GDPR/CCPA requests.
