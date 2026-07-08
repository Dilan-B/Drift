# Sign in with Apple — Setup Guide

Client code is shipped: `appleSignIn.js` (native flow + `AppleSignInButton`),
wired into `OnboardingScreen.jsx`'s auth slide as the first social option.
`app.json` now sets `ios.usesAppleSignIn: true` and adds the
`expo-apple-authentication` plugin. Two things still need doing outside the code:
**Apple Developer** config and the **Supabase** provider.

Apple sign-in only works in a **dev client / TestFlight / App Store build**
(not Expo Go), and only on a real device or a simulator signed into an Apple ID.

---

## Step 1 — Apple Developer portal

1. <https://developer.apple.com/account> → **Certificates, Identifiers & Profiles → Identifiers**.
2. Open your App ID `com.drift.app` → enable the **Sign In with Apple**
   capability → Save. (EAS will pick this up on the next build because
   `usesAppleSignIn` is set.)
3. For Supabase token validation you need a **Services ID** + **Key**:
   - **Identifiers → +** → *Services IDs* → create one, e.g. `com.drift.auth`.
     Enable "Sign In with Apple" on it and configure it to your primary App ID.
   - **Keys → +** → enable "Sign In with Apple", download the `.p8` **once**
     (you can't re-download it). Note the **Key ID** and your **Team ID**.

## Step 2 — Supabase dashboard

1. Dashboard → **Authentication → Providers → Apple** → enable.
2. Fill in:
   - **Client IDs**: add **both** `com.drift.app` (the app bundle id — this is
     what the native `signInWithIdToken` flow presents) and your Services ID
     `com.drift.auth`. Comma-separate them.
   - **Secret Key (for OAuth)**: Supabase can generate the client secret from
     your **Team ID**, **Key ID**, and the `.p8` contents — paste those in, or
     paste a pre-generated JWT secret.
3. Save.

> The native iOS flow (what this app uses) authenticates with the **bundle id**
> as the audience, so `com.drift.app` MUST be in the Client IDs list or Supabase
> rejects the token with an `audience` error. The Services ID is needed for the
> web/OAuth fallback and for generating the secret.

## Step 3 — Build & test

1. `npx expo prebuild -p ios` (or let EAS build) so the native capability +
   entitlement land in the Xcode project. Then a dev build / TestFlight build.
2. Onboarding → the black **Sign in with Apple** button appears first. Tap it →
   Face ID / Apple ID sheet → you should land in the app.
3. New Apple accounts get the **30-minute welcome bonus** and go through
   username setup (Apple accounts have no username, and after the first sign-in
   Apple stops returning the name, so we always let the user pick one).

## Notes

- **Email relay.** Users can choose "Hide My Email"; Supabase stores the Apple
  private-relay address. The app already tolerates users with no/odd email.
- **Name only comes once.** Apple returns `fullName`/`email` **only on the very
  first authorization** for a given Apple ID. We don't rely on it — username
  setup covers naming — so returning users sign in fine.
- **Guideline 4.8 / 4.0.** Offering Google (and phone) sign-in means Apple
  review effectively requires Sign in with Apple to be offered too. This closes
  that gap.
- **Simulator:** works only if the simulator is signed into an Apple ID
  (Settings → Sign in). Otherwise the button renders but the sheet errors — test
  on a real device.
