/**
 * AndroidBlockerModal.jsx
 * Everything Apple gives Drift for free on iOS, rebuilt.
 *
 * On iOS this screen does not exist: one Family Controls prompt grants
 * blocking, and FamilyActivityPicker is a system sheet that returns opaque
 * tokens. Android has neither, so Drift has to
 *
 *   1. walk the user through two Settings screens by hand, because neither
 *      permission can be requested with a dialog, and
 *   2. render its own list of installed apps.
 *
 * WHY IT RE-READS ON FOREGROUND
 * Granting happens in Settings, in another app. Nothing calls back, so the
 * only way to know it worked is to look again when Drift returns to the front.
 *
 * WHY THE STEPS ARE ORDERED AND GATED
 * Both permissions are required and they fail differently: without usage
 * access Drift never notices the app opening, and without overlay it notices
 * and can do nothing. Showing the app picker before both are granted would let
 * someone pick ten apps and believe they were blocked.
 */
import React from "react";
import {
  View, Text, TouchableOpacity, Modal, ScrollView, TextInput,
  ActivityIndicator, AppState, Platform,
} from "react-native";
import { FF, getTheme } from "./theme";
import { androidBlocker } from "./screenTime";

const FO  = FF.bodyBold;
const FOM = FF.kicker;
const FK  = FF.bodyMed;
const FB  = FF.body;

export default function AndroidBlockerModal({ visible, onClose, dark = false, firstTime = false }) {
  const { ink, paper, earn } = getTheme(dark);

  const [status, setStatus]   = React.useState(null);
  const [apps, setApps]       = React.useState([]);
  const [picked, setPicked]   = React.useState(new Set());
  const [query, setQuery]     = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    const st = await androidBlocker.getStatus();
    setStatus(st);
    return st;
  }, []);

  // Initial load: status first, then the app list, which is the slow part
  // (labels and icons are read per package from PackageManager).
  React.useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const st = await refresh();
      if (!alive) return;
      if (st.ready) {
        const [list, blocked] = await Promise.all([
          androidBlocker.getInstalledApps(),
          androidBlocker.getBlockedApps(),
        ]);
        if (!alive) return;
        setApps(list);
        setPicked(new Set(blocked.map(b => b.packageName)));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [visible, refresh]);

  // The user leaves to Settings and comes back; this is the only signal.
  React.useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener("change", async s => {
      if (s !== "active") return;
      const st = await refresh();
      if (st.ready && apps.length === 0) {
        setApps(await androidBlocker.getInstalledApps());
      }
    });
    return () => sub.remove();
  }, [visible, refresh, apps.length]);

  const toggle = pkg => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(pkg)) next.delete(pkg); else next.add(pkg);
      return next;
    });
  };

  const save = React.useCallback(async () => {
    await androidBlocker.setBlockedApps(Array.from(picked));
    onClose?.();
  }, [picked, onClose]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(a => a.label.toLowerCase().includes(q));
  }, [apps, query]);

  const ready = !!status?.ready;

  // During onboarding, leaving with nothing blocked means the core feature is
  // off. It must still be possible — trapping someone behind a permission they
  // have decided not to grant is worse — but it should not be the default path.
  const canFinish = !firstTime || !ready || picked.size > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={canFinish ? onClose : undefined}>
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        {/* Header */}
        <View style={{
          paddingTop: Platform.OS === "ios" ? 54 : 32,
          paddingBottom: 14, paddingHorizontal: 20,
          backgroundColor: paper.card,
          borderBottomWidth: 0.5, borderBottomColor: ink.border,
          flexDirection: "row", alignItems: "center",
        }}>
          {!firstTime && (
            <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
              <Text style={{ fontSize: 22, color: ink.mid, lineHeight: 26 }}>×</Text>
            </TouchableOpacity>
          )}
          <Text style={{ fontFamily: FO, fontSize: 17, color: ink.deep, flex: 1 }}>
            {ready ? "Pick apps to block" : "Let Drift hold your apps"}
          </Text>
          {ready && (
            <TouchableOpacity onPress={save} disabled={!canFinish}>
              <Text style={{
                fontFamily: FK, fontSize: 15,
                color: canFinish ? earn.deep : ink.faint,
              }}>
                Done
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={earn.deep} />
          </View>
        ) : !ready ? (
          <PermissionSteps
            status={status}
            theme={{ ink, paper, earn }}
            onOpen={async which => {
              if (which === "usage") await androidBlocker.openUsageAccessSettings();
              if (which === "overlay") await androidBlocker.openOverlaySettings();
              if (which === "a11y") await androidBlocker.openAccessibilitySettings();
            }}
          />
        ) : (
          <>
            <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search apps"
                placeholderTextColor={ink.faint}
                style={{
                  backgroundColor: paper.card, borderRadius: 12,
                  borderWidth: 1, borderColor: ink.border,
                  paddingHorizontal: 14, paddingVertical: 10,
                  fontFamily: FB, fontSize: 14, color: ink.deep,
                }}
              />
              <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, marginTop: 8 }}>
                {picked.size === 0
                  ? "Nothing blocked yet."
                  : `${picked.size} app${picked.size === 1 ? "" : "s"} will be held when you run out of time.`}
              </Text>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40 }}>
              {filtered.map(app => {
                const on = picked.has(app.packageName);
                return (
                  <TouchableOpacity
                    key={app.packageName}
                    onPress={() => toggle(app.packageName)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: "row", alignItems: "center",
                      paddingVertical: 13, paddingHorizontal: 14,
                      borderRadius: 12, marginBottom: 8,
                      backgroundColor: on ? earn.greenLo : paper.card,
                      borderWidth: 1,
                      borderColor: on ? earn.green : ink.border,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: FK, fontSize: 15, color: ink.deep }}>
                        {app.label}
                      </Text>
                      <Text style={{ fontFamily: FB, fontSize: 11, color: ink.faint, marginTop: 2 }}>
                        {app.packageName}
                      </Text>
                    </View>
                    <View style={{
                      width: 22, height: 22, borderRadius: 11,
                      borderWidth: 1.5,
                      borderColor: on ? earn.green : ink.faint,
                      backgroundColor: on ? earn.green : "transparent",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      {on && <Text style={{ color: paper.card, fontSize: 13, lineHeight: 15 }}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
              {filtered.length === 0 && (
                <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid, textAlign: "center", marginTop: 24 }}>
                  No apps match “{query}”.
                </Text>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

/**
 * The permission walk.
 *
 * Each step names the exact screen and the exact toggle, because the deep link
 * lands on different screens across OEM builds and a user who cannot find the
 * switch simply gives up.
 */
function PermissionSteps({ status, theme, onOpen }) {
  const { ink, paper, earn } = theme;

  const steps = [
    {
      key: "usage",
      done: !!status?.usageAccess,
      required: true,
      title: "Usage access",
      body: "Lets Drift see which app is open, so it knows when to step in. Find Drift in the list and turn it on.",
    },
    {
      key: "overlay",
      done: !!status?.overlay,
      required: true,
      title: "Display over other apps",
      body: "Lets Drift put the block screen in front of an app you've chosen to hold. Without it Drift can see the app open but can't do anything about it.",
    },
    {
      key: "a11y",
      done: !!status?.accessibility,
      required: false,
      title: "Instant blocking",
      body: "Optional. Without it blocking still works, but can take about a second — long enough to see the feed before the block lands. Drift only reads which app comes to the front, never what's on screen.",
    },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <View style={{
        backgroundColor: earn.blueLo, padding: 14, borderRadius: 12, marginBottom: 18,
        borderWidth: 1, borderColor: "rgba(90,180,212,0.2)",
      }}>
        <Text style={{ fontFamily: FOM, fontSize: 9, color: "#2A7FA0", letterSpacing: 1.5, marginBottom: 6 }}>
          HOW THIS WORKS
        </Text>
        <Text style={{ fontFamily: FB, fontSize: 12, color: "#2A7FA0", lineHeight: 18 }}>
          Android has no built-in way to let one app block another, so Drift does it
          itself: it watches which app is in front and covers the ones you pick until
          you've earned time. That needs two permissions Android only grants from its
          own Settings.
        </Text>
      </View>

      {steps.map(step => (
        <TouchableOpacity
          key={step.key}
          onPress={() => onOpen(step.key)}
          activeOpacity={0.75}
          style={{
            padding: 16, borderRadius: 14, marginBottom: 12,
            backgroundColor: paper.card,
            borderWidth: 1.5,
            borderColor: step.done ? earn.green : ink.border,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
            <View style={{
              width: 20, height: 20, borderRadius: 10, marginRight: 10,
              alignItems: "center", justifyContent: "center",
              backgroundColor: step.done ? earn.green : "transparent",
              borderWidth: 1.5, borderColor: step.done ? earn.green : ink.faint,
            }}>
              {step.done && <Text style={{ color: paper.card, fontSize: 12, lineHeight: 14 }}>✓</Text>}
            </View>
            <Text style={{ fontFamily: FK, fontSize: 15, color: ink.deep, flex: 1 }}>
              {step.title}
            </Text>
            <Text style={{ fontFamily: FOM, fontSize: 9, letterSpacing: 1, color: step.required ? earn.deep : ink.faint }}>
              {step.done ? "ON" : step.required ? "REQUIRED" : "OPTIONAL"}
            </Text>
          </View>
          <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, lineHeight: 18 }}>
            {step.body}
          </Text>
          {!step.done && (
            <Text style={{ fontFamily: FK, fontSize: 13, color: earn.deep, marginTop: 10 }}>
              Open settings →
            </Text>
          )}
        </TouchableOpacity>
      ))}

      <Text style={{
        fontFamily: FB, fontSize: 11, color: ink.faint,
        lineHeight: 17, marginTop: 6, textAlign: "center",
      }}>
        Drift can’t block apps as firmly as an iPhone can — Android lets you stop it
        from Settings at any time. It’s here to make drifting cost something, not to
        make it impossible.
      </Text>
    </ScrollView>
  );
}
