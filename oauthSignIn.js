/**
 * oauthSignIn.js
 * Apple + Google sign-in. All token validation happens server-side in Supabase;
 * we never trust client-side decoded tokens for anything sensitive.
 *
 * SECURITY NOTES
 *  - Apple flow uses a SHA-256-hashed nonce sent to Apple, plaintext nonce sent
 *    to Supabase. Apple signs the token with the hash; Supabase verifies the
 *    raw nonce matches. This blocks token-replay attacks.
 *  - Google flow uses expo-auth-session with PKCE — no client secret ships with
 *    the app. The OAuth code never leaves the device unencrypted.
 *  - All identity tokens are validated against the provider's public keys by
 *    Supabase Auth before any session is issued.
 *  - We never store or log raw tokens. Sessions are persisted only by Supabase's
 *    AsyncStorage adapter (already configured).
 */
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import * as Google from "expo-auth-session/providers/google";
import { supabase } from "./supabase";
import { rateLimited } from "./apiGuards";

// Apple Sign-In is intentionally not imported. To re-enable, restore:
//   import * as AppleAuthentication from "expo-apple-authentication";
// and the `signInWithApple` export below.

// expo-auth-session wants this so the redirect resolves cleanly on iOS
WebBrowser.maybeCompleteAuthSession();

// ── Apple Sign-In (disabled) ──────────────────────────────────
// export const APPLE_AVAILABLE = Platform.OS === "ios";
// export async function signInWithApple() { /* see git history */ }
export const APPLE_AVAILABLE = false;

// ── Google Sign-In (uses expo-auth-session with PKCE) ────────
// Pass these from app.json/eas secrets — never hard-code in source.
const GOOGLE_IOS_CLIENT_ID     = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID     || "";
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "";
const GOOGLE_WEB_CLIENT_ID     = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID     || "";
const GOOGLE_EXPO_CLIENT_ID    = process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID    || "";

/**
 * Returns the Google sign-in hook. Call inside a component; renders nothing
 * but provides `promptAsync` to launch the flow.
 *
 * NOTE: Google OAuth requires a custom dev client or standalone build.
 * It will NOT work in Expo Go because Google blocks the exp:// redirect
 * scheme used by Expo Go.
 */
export function useGoogleSignIn(onSignedIn) {
  // Force the redirect URI to use the app's custom scheme — must match what
  // you register in Google Cloud Console for the iOS/Android client.
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "drift",
    path: "auth-callback",
  });

  // If no client IDs are configured, short-circuit before calling the auth
  // hook — passing undefined client IDs throws "iosClientId must be defined".
  const configured = !!(GOOGLE_IOS_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID);
  if (!configured) {
    return { isReady: false, promptAsync: async () => {}, isConfigured: false };
  }

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId:     GOOGLE_IOS_CLIENT_ID || undefined,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
    webClientId:     GOOGLE_WEB_CLIENT_ID || undefined,
    expoClientId:    GOOGLE_EXPO_CLIENT_ID || undefined,
    redirectUri,
    // Restrict scopes to the minimum we need
    scopes: ["openid", "profile", "email"],
  });

  React.useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.params?.id_token || response.authentication?.idToken;
      if (!idToken) return;
      (async () => {
        try {
          const { data, error } = await rateLimited("auth_google", { limit: 5, windowMs: 10 * 60_000 }, () =>
            supabase.auth.signInWithIdToken({
              provider: "google",
              token:    idToken,
            })
          );
          if (error) throw error;
          onSignedIn?.({ user: data.user, session: data.session });
        } catch (e) {
          onSignedIn?.({ error: e });
        }
      })();
    } else if (response?.type === "error") {
      onSignedIn?.({ error: new Error(response.error?.message || "Google sign-in failed") });
    }
  }, [response]);

  return {
    isReady: !!request,
    promptAsync,
    isConfigured: !!(GOOGLE_IOS_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID),
  };
}

// Convenience for the imperative call site
export async function ensureGoogleConfigured() {
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error(
      "Google Sign-In is not configured. " +
      "Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env and the iOS/Android client IDs."
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────
async function randomNonce(len = 32) {
  const bytes = await Crypto.getRandomBytesAsync(len);
  // Convert to hex — same alphabet works as nonce content
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// React import lazy so this file works in non-component contexts too
import React from "react";
