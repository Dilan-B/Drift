/**
 * appleSignIn.js
 * Sign in with Apple (native) → Supabase.
 *
 * Apple is required by App Store review (Guideline 4.8) once you offer other
 * third-party logins like Google, and it's the lowest-friction, zero-cost
 * option on iOS — so it's the primary social button.
 *
 * SECURITY / FLOW
 *  - `AppleAuthentication.signInAsync` returns a short-lived, Apple-signed
 *    `identityToken` (a JWT). We hand that straight to Supabase, which validates
 *    it against Apple's public keys before issuing a session. We never trust or
 *    decode it client-side.
 *  - Apple only returns the user's name/email on the FIRST authorization ever;
 *    on later sign-ins those are null. We don't depend on them — username setup
 *    handles naming — so a returning user still signs in cleanly.
 *  - iOS only. Requires `ios.usesAppleSignIn: true` in app.json and the Apple
 *    provider enabled in the Supabase dashboard (see docs/APPLE_AUTH_SETUP.md).
 */
import React, { useEffect, useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { rateLimited } from "./apiGuards";

export async function isAppleAuthAvailable() {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Runs the native Apple flow and exchanges the identity token for a Supabase
 * session. Returns one of:
 *   { user, session } on success
 *   { cancelled: true } if the user dismissed the sheet
 *   { error } on failure
 */
export async function signInWithApple() {
  if (Platform.OS !== "ios") {
    return { error: new Error("Apple sign-in is only available on iOS.") };
  }
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential?.identityToken) {
      return { error: new Error("Apple didn't return an identity token. Try again.") };
    }
    const { data, error } = await rateLimited("auth_apple", { limit: 5, windowMs: 10 * 60_000 }, () =>
      supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      })
    );
    if (error) return { error };
    return { user: data.user, session: data.session };
  } catch (e) {
    // The user tapping "Cancel" on the sheet surfaces as a canceled request.
    if (e?.code === "ERR_REQUEST_CANCELED" || e?.code === "ERR_CANCELED") {
      return { cancelled: true };
    }
    return { error: e };
  }
}

/**
 * Official Apple button. Renders nothing when Apple auth is unavailable
 * (non-iOS, simulator without an Apple ID, older iOS), so callers can drop it
 * in unconditionally.
 */
export function AppleSignInButton({ onDone, onError, mode = "signup", dark = false, style }) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    isAppleAuthAvailable().then(a => { if (mounted) setAvailable(a); });
    return () => { mounted = false; };
  }, []);

  if (!available) return null;

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={
        mode === "signup"
          ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
          : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
      }
      buttonStyle={
        dark
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={14}
      style={[{ height: 52, width: "100%" }, style]}
      onPress={async () => {
        const res = await signInWithApple();
        if (res.cancelled) return;
        if (res.error) { onError?.(res.error); return; }
        onDone?.(res.user);
      }}
    />
  );
}
