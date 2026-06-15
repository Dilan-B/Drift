import { supabase } from "./supabase";

function readAuthParams(url) {
  const raw = String(url || "");
  const query = raw.includes("?") ? raw.split("?")[1].split("#")[0] : "";
  const hash = raw.includes("#") ? raw.split("#")[1] : "";
  return `${query}&${hash}`.split("&").reduce((params, pair) => {
    if (!pair) return params;
    const [rawKey, ...rawValueParts] = pair.split("=");
    if (!rawKey) return params;
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    const value = decodeURIComponent(rawValueParts.join("=").replace(/\+/g, " "));
    params[key] = value;
    return params;
  }, {});
}

export async function handleSupabaseAuthCallback(url) {
  if (!url || !String(url).includes("auth-callback")) {
    return { handled: false };
  }

  try {
    const params = readAuthParams(url);
    const callbackError = params.error_description || params.error;
    if (callbackError) {
      return { handled: true, error: new Error(callbackError) };
    }

    const code = params.code;
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return { handled: true, user: data?.user || data?.session?.user || null };
    }

    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    if (accessToken && refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      return { handled: true, user: data?.user || data?.session?.user || null };
    }

    return { handled: true, error: new Error("Verification link is missing sign-in details.") };
  } catch (error) {
    return { handled: true, error };
  }
}
