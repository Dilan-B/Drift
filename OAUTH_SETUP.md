# Drift — Apple + Google Sign-In Setup

Both providers are wired in code. You need to configure 3 things:
1. Supabase Auth providers (server side)
2. Google OAuth clients (Google Cloud Console)
3. Apple Sign-In Service ID (Apple Developer)

---

## 1. Install the packages

```bash
npx expo install expo-apple-authentication expo-auth-session expo-crypto expo-web-browser
```

You already have `expo-apple-authentication` installed. The others are new.

---

## 2. Supabase — enable providers

Dashboard → **Authentication → Providers**.

### Apple
1. Toggle **Apple** to ON
2. Fill in:
   - **Services ID** — from your Apple Developer account (see section 4)
   - **Team ID** — from Apple Developer (Membership page)
   - **Key ID** — from the AuthKey you create
   - **Secret Key (private key)** — the contents of the `.p8` file from Apple
3. **Redirect URL** — copy what Supabase shows. Paste it into Apple's Service ID config.

### Google
1. Toggle **Google** to ON
2. Fill in:
   - **Client ID (for OAuth)** — your **Web** client ID from Google Cloud (see section 3)
   - **Client Secret** — the matching secret
3. **Redirect URL** — copy what Supabase shows. Add it to your Google OAuth client's "Authorized redirect URIs."

Supabase will validate Apple/Google tokens against their public keys — clients can't forge them.

---

## 3. Google Cloud Console

Project → **APIs & Services → Credentials → Create credentials → OAuth client ID**.

You need **three** OAuth clients (one per platform):

### a) Web client (Supabase needs this)
- Application type: **Web application**
- Authorized redirect URIs: paste the redirect URL Supabase showed you
- Copy the **Client ID** + **Secret** into Supabase (Section 2)
- Also put the Client ID into your `.env`:
  ```
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
  ```

### b) iOS client
- Application type: **iOS**
- Bundle ID: `com.drift.app` (matches `app.json`)
- Copy the **Client ID** into `.env`:
  ```
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=YOUR_IOS_CLIENT_ID.apps.googleusercontent.com
  ```

### c) Android client (when you ship Android)
- Application type: **Android**
- Package name: `com.drift.app`
- SHA-1 certificate fingerprint: get with
  ```
  npx expo credentials:manager   # or eas credentials
  ```
- Copy:
  ```
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com
  ```

The CLIENT IDs are public (they're meant to be in your bundle).
The CLIENT SECRET stays only in Supabase — **never** in your app or `.env`.

---

## 4. Apple Developer Console

[developer.apple.com](https://developer.apple.com/account/)

### a) Enable Apple Sign-In capability on the App ID
- **Certificates, Identifiers & Profiles → Identifiers → your App ID (`com.drift.app`)**
- Edit → check **Sign In with Apple** → save

### b) Create a Services ID
- **Identifiers → + → Services IDs**
- Description: "Drift Web Auth"
- Identifier: `com.drift.app.web` (anything unique)
- Enable **Sign In with Apple**
- Configure → add Supabase's redirect URL → save
- This Services ID is what you paste in Supabase's "Services ID" field

### c) Create a Sign-In Key
- **Keys → + → register a new key**
- Check **Sign In with Apple** → configure → pick your primary App ID → save
- Download the `.p8` file (you only get it once!)
- Copy the **Key ID** shown on screen
- The contents of the `.p8` file go in Supabase's "Secret Key" field

### d) Get your Team ID
- Top right of Apple Developer site → Membership → Team ID
- Paste in Supabase

---

## 5. .env file

Add to `C:\Users\dilan\Drift\.env` (gitignored):

```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...apps.googleusercontent.com
```

These IDs are PUBLIC (OAuth client IDs are designed to ship in clients). The
*secret* never goes here — it lives in Supabase's dashboard only.

---

## 6. Rebuild

Apple Sign-In and Google Sign-In both require a custom dev client / standalone
build — they cannot run in Expo Go.

```bash
# iOS dev client (run on device)
npx expo run:ios --device

# Or build with EAS
eas build --profile development --platform ios
```

---

## Security model

| Concern | How it's handled |
|---|---|
| Token theft via replay | Apple flow generates a random nonce, sends SHA-256 hash to Apple, sends raw nonce to Supabase. Apple's signed token must contain hash(rawNonce). Different request = different nonce. |
| Token forgery | Supabase validates the ID token signature against Apple/Google's published public keys. A forged token won't have a valid signature. |
| Client secret leak | Client secrets never ship in the app — only in Supabase server config. |
| OAuth code interception | Google flow uses PKCE (proof key for code exchange) via `expo-auth-session`. The code verifier never leaves the device. |
| Session hijacking | Sessions are stored via Supabase's official `AsyncStorage` adapter and refreshed automatically. Tokens never touch our own storage. |
| Account takeover via duplicate email | Supabase by default links an OAuth login to an existing email-based account *only if the email is confirmed*. Keep email confirmation ON in production. |
| First-time profile injection | DB trigger creates the profile row server-side with a random username. Even if a malicious user crafted user_metadata, the trigger normalizes it. |
| Username squatting on social handles | Username uniqueness is enforced by `profiles_username_key` unique index at the DB level. Race conditions return clear errors to the user. |

---

## Testing checklist

- [ ] Apple button appears on iOS sign-in screen
- [ ] Tapping Apple → sees Apple's native sheet → sign in → lands in app
- [ ] First Apple sign-in shows "Pick your username" modal
- [ ] Picking a taken username shows "That username is taken"
- [ ] Picking a valid username persists and shows in Friends tab
- [ ] Google button appears on both iOS and Android
- [ ] Tapping Google → opens browser → sign in → returns to app
- [ ] Trial gets claimed automatically (subscription card shows "Pro · active")
- [ ] Sign out, sign back in via Google with the same Google account → recognizes you
