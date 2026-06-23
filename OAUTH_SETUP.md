# Drift Supabase Auth Setup

Drift uses Supabase Auth for:

- Email/password signup with required email verification
- Google sign-in as the only social provider
- Supabase sessions for RLS, Edge Functions, storage, and profile ownership

The app already sends email users to `drift://auth-callback`, handles the callback, and blocks unverified sessions before loading app data.

## 1. Supabase Email Auth

Dashboard -> Authentication -> Providers -> Email

Recommended production settings:

- Enable Email provider
- Enable Confirm email
- Disable anonymous sign-ins
- Keep secure password requirements enabled
- Configure auth rate limits under Authentication -> Rate Limits

Email confirmation and password reset emails need a reliable sender. Supabase's default email service is fine for early testing, but production should use custom SMTP.

Dashboard -> Project Settings -> Authentication -> SMTP Settings

Good providers include Resend, Postmark, SendGrid, AWS SES, Brevo, or ZeptoMail.

## 2. Redirect URLs

Dashboard -> Authentication -> URL Configuration

Set:

```text
Site URL: your production landing page, for example https://your-domain.com
Additional Redirect URLs:
drift://auth-callback
drift://**
```

The app passes `emailRedirectTo: "drift://auth-callback"` for signup and resend flows, so that deep link must be in the additional redirect allow-list. The app config already declares:

```json
{
  "expo": {
    "scheme": "drift"
  }
}
```

## 3. Google Provider In Supabase

Dashboard -> Authentication -> Providers -> Google

1. Toggle Google ON.
2. Paste the Google Web OAuth Client ID.
3. Paste the matching Google Web OAuth Client Secret.
4. Copy the Supabase Redirect URL shown on that provider page.
5. Add that URL to the Google Web OAuth client's Authorized redirect URIs.

Only the Google Web OAuth secret goes into Supabase. Never put that secret in the app or `.env`.

## 4. Google Cloud OAuth Clients

Google Cloud Console -> APIs & Services -> Credentials -> Create credentials -> OAuth client ID

Create these clients:

### Web client

- Application type: Web application
- Authorized redirect URIs: the Supabase Google provider Redirect URL
- Put the Client ID and Client Secret into Supabase
- Put only the Client ID into `.env`

```text
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

### iOS client

- Application type: iOS
- Bundle ID: `com.drift.app`
- Put the Client ID into `.env`

```text
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=YOUR_IOS_CLIENT_ID.apps.googleusercontent.com
```

### Android client

- Application type: Android
- Package name: `com.drift.app`
- SHA-1 certificate fingerprint: get it from EAS credentials or `npx expo credentials:manager`
- Put the Client ID into `.env`

```text
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com
```

OAuth Client IDs are public and safe to ship in the app bundle. OAuth Client Secrets are private and must stay in Supabase or Google Cloud only.

## 5. App Environment

Add this to `C:\Users\dilan\Drift\.env`:

```text
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...apps.googleusercontent.com
```

`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` can stay blank until Android is ready.

## 6. Build And Test

Google OAuth requires a dev client or standalone build. It will not work in Expo Go.

```bash
npx expo run:ios --device
```

or:

```bash
eas build --profile development --platform ios
```

Testing checklist:

- Email signup creates an account but shows the "Check your email" screen.
- Verification email opens `drift://auth-callback`.
- After tapping the link, Drift signs in and continues onboarding.
- Trying to use an unverified stored session signs the user out.
- Google button appears.
- Google sign-in opens the browser, returns to Drift, and creates a Supabase session.
- First Google sign-in prompts for username if Supabase created a placeholder.
