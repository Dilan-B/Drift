/**
 * LockboxScreen.jsx
 * Lockbox: place a box, put the phone in it, leave it there.
 *
 * PHASES
 *   setup   — choose a length and (optionally) name the task
 *   place   — AR: find a surface, drop the box
 *   settle  — "set your phone in the box", waiting for the sensors to go quiet
 *   active  — the box is holding. A plain countdown, screen on.
 *   breach  — the phone moved. Grace countdown; put it back or forfeit.
 *   done    — completed or forfeited
 *
 * WHY THE SCREEN STAYS ON
 *   Live detection needs the app running, and iOS freezes Drift the moment the
 *   screen locks. expo-keep-awake is held from `settle` to the end, exactly as
 *   DriftInScreen does for a focus session.
 *
 * THE AR IS OPTIONAL BY DESIGN
 *   Devices without ARKit, or a user who declines the camera, skip `place` and
 *   go straight to `settle`. The box is ceremony; the accelerometer is the
 *   mechanism, and the mechanism must not depend on the ceremony.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Platform,
  AppState, BackHandler, StatusBar, ActivityIndicator, findNodeHandle,
  requireNativeComponent, UIManager, TextInput,
} from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import Slider from "@react-native-community/slider";
import { FF, getTheme } from "./theme";
import { CloseIcon, CheckIcon, LockIcon } from "./Icons";
import { selectionTick, notify } from "./haptics";
import * as Lockbox from "./lockbox";

const DURATIONS = [15, 25, 45, 60, 90];

// The native AR view is only present in a dev/standalone build. requireNativeComponent
// throws in Expo Go, so this is resolved lazily and the screen degrades to the
// no-AR path rather than crashing the tab.
let ARView = null;
try {
  if (Platform.OS === "ios" && UIManager.getViewManagerConfig?.("LockboxARView")) {
    ARView = requireNativeComponent("LockboxARView");
  }
} catch { ARView = null; }

const arManager = UIManager.getViewManagerConfig?.("LockboxARView") ? UIManager : null;
const callAR = (ref, command) => {
  const node = findNodeHandle(ref);
  if (!node || !arManager) return;
  const cfg = arManager.getViewManagerConfig("LockboxARView");
  const id = cfg?.Commands?.[command];
  if (id != null) arManager.dispatchViewManagerCommand(node, id, []);
};

const fmt = (secs) => {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
};

export default function LockboxScreen({ dark = false, onClose, onCompleted, onStarted, onEnded }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const [phase,   setPhase]   = useState("setup");
  const [minutes, setMinutes] = useState(25);
  const [task,    setTask]    = useState("");
  const [session, setSession] = useState(null);
  const [left,    setLeft]    = useState(0);
  const [grace,   setGrace]   = useState(null);
  const [result,  setResult]  = useState(null);
  const [surface, setSurface] = useState(false);
  const [busy,    setBusy]    = useState(false);

  const arRef      = useRef(null);
  const phaseRef   = useRef(phase);
  const sessionRef = useRef(null);
  const unsubRef   = useRef(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // Restore an in-flight session — the countdown is wall-clock based, so a
  // reload or a crash mid-session must not silently hand back the reward.
  useEffect(() => {
    (async () => {
      const s = await Lockbox.getSession();
      if (!s) return;
      if (Lockbox.isComplete(s)) {
        const rec = await Lockbox.finishSession("completed");
        setResult(rec); setPhase("done"); onCompleted?.(rec);
        return;
      }
      setSession(s);
      setPhase(s.disturbedAt ? "breach" : "active");
      startMonitoring();
    })();
    return () => { unsubRef.current?.(); Lockbox.stopMonitoring(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Screen stays awake from the moment enforcement starts.
  useEffect(() => {
    const live = ["settle", "active", "breach"].includes(phase);
    if (live) activateKeepAwakeAsync().catch(() => {});
    else deactivateKeepAwake();
    return () => deactivateKeepAwake();
  }, [phase]);

  // Leaving Drift mid-session is the same as taking the phone out: we can no
  // longer see the sensors, so we must not pretend the box is still holding.
  useEffect(() => {
    if (!["active", "breach"].includes(phase)) return;
    const sub = AppState.addEventListener("change", (st) => {
      if (st !== "active" && phaseRef.current === "active") markDisturbed();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Android hardware back — refuse to drop out of a live session by accident.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (["active", "breach", "settle"].includes(phaseRef.current)) return true;
      return false;
    });
    return () => sub.remove();
  }, []);

  const startMonitoring = useCallback(async () => {
    unsubRef.current?.();
    unsubRef.current = Lockbox.onStateChange(({ state }) => {
      if (state === "disturbed") markDisturbed();
      else if (state === "settled") markSettled();
    });
    try { await Lockbox.startMonitoring(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markDisturbed = useCallback(async () => {
    if (phaseRef.current === "settle") return;      // still being put down
    if (sessionRef.current?.disturbedAt) return;    // already counting
    const next = await Lockbox.updateSession({
      disturbedAt: Date.now(),
      breaches: (sessionRef.current?.breaches || 0) + 1,
    });
    if (!next) return;
    setSession(next);
    setPhase("breach");
    notify(false);
  }, []);

  const markSettled = useCallback(async () => {
    if (phaseRef.current === "settle") {
      // The phone has come to rest in the box — enforcement starts now.
      setPhase("active");
      notify(true);
      return;
    }
    if (!sessionRef.current?.disturbedAt) return;
    const next = await Lockbox.updateSession({ disturbedAt: null });
    setSession(next);
    setGrace(null);
    setPhase("active");
    notify(true);
  }, []);

  // One ticker drives the session countdown, the grace countdown, and both
  // terminal transitions. A single interval is easier to reason about than
  // three that can disagree about what time it is.
  useEffect(() => {
    if (!["active", "breach"].includes(phase)) return;
    const tick = () => {
      const s = sessionRef.current;
      if (!s) return;
      const now = Date.now();
      setLeft(Math.max(0, Math.round((s.endsAt - now) / 1000)));

      if (s.disturbedAt) {
        const g = Lockbox.graceRemaining(s, now);
        setGrace(g);
        if (g <= 0) { settle("forfeited"); return; }
      }
      if (now >= s.endsAt) settle("completed");
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const settle = useCallback(async (status) => {
    unsubRef.current?.();
    await Lockbox.stopMonitoring();
    const rec = await Lockbox.finishSession(status);
    setResult(rec);
    setPhase("done");
    setGrace(null);
    notify(status === "completed");
    onEnded?.(rec);
    if (status === "completed") onCompleted?.(rec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Flow ──────────────────────────────────────────────────
  const beginPlacement = async () => {
    selectionTick();
    if (ARView && arManager) { setPhase("place"); return; }
    await beginSettle();     // no ARKit — skip the ceremony, keep the mechanism
  };

  const beginSettle = async () => {
    setBusy(true);
    try {
      const s = await Lockbox.startSession({ minutes, task });
      setSession(s);
      setPhase("settle");
      onStarted?.(s);
      await startMonitoring();
    } catch (e) {
      Alert.alert("Couldn't start", e?.message || "Try again.");
    } finally { setBusy(false); }
  };

  const confirmPlaced = async () => {
    callAR(arRef.current, "pauseSession");   // stop the camera before the long part
    await beginSettle();
  };

  const cancel = () => {
    Alert.alert(
      "End this session?",
      "You won't earn anything for the time so far.",
      [
        { text: "Keep going", style: "cancel" },
        { text: "End", style: "destructive", onPress: () => settle("cancelled") },
      ],
    );
  };

  // ── Render ────────────────────────────────────────────────
  const night = "#0B1A11";
  const onNight = "rgba(247,247,244,0.72)";

  if (phase === "place" && ARView) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <StatusBar barStyle="light-content" />
        <ARView
          ref={arRef}
          style={StyleSheet.absoluteFill}
          boxSize={0.22}
          onSurfaceFound={() => setSurface(true)}
          onPlaced={() => { notify(true); setSurface(true); }}
          onARError={async ({ nativeEvent }) => {
            Alert.alert("Camera couldn't map the room", nativeEvent?.message || "Setting the phone down works too.");
            await beginSettle();
          }}
        />
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 44, paddingHorizontal: 28 }}>
          <Text style={{
            fontFamily: FF.body, fontSize: 14, color: "rgba(255,255,255,0.9)",
            textAlign: "center", marginBottom: 16,
          }}>
            {surface
              ? "Aim at the spot you want, then place the box."
              : "Move your phone slowly to find a flat surface."}
          </Text>
          <TouchableOpacity
            onPress={() => callAR(arRef.current, "place")}
            style={{
              backgroundColor: earn.green, borderRadius: 14,
              paddingVertical: 15, alignItems: "center", marginBottom: 10,
            }}
          >
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: "#fff" }}>Place the box</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmPlaced} style={{ paddingVertical: 12, alignItems: "center" }}>
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: "rgba(255,255,255,0.75)" }}>
              Done — my phone's going in
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (phase === "settle") {
    return (
      <View style={[s.night, { backgroundColor: night }]}>
        <StatusBar barStyle="light-content" />
        <Text style={[s.bigSerif, { color: "#F7F7F4" }]}>Set your phone{"\n"}in the box</Text>
        <Text style={[s.sub, { color: onNight }]}>
          Face down. The session starts once it's completely still.
        </Text>
        <ActivityIndicator color="#7FB58F" style={{ marginTop: 30 }} />
        <TouchableOpacity onPress={() => settle("cancelled")} style={{ marginTop: 44 }}>
          <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: "rgba(247,247,244,0.5)" }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === "breach") {
    return (
      <View style={[s.night, { backgroundColor: "#2A1512" }]}>
        <StatusBar barStyle="light-content" />
        <Text style={{ fontFamily: FF.kicker, fontSize: 10, letterSpacing: 1.8, color: "#E89078" }}>
          PUT IT BACK
        </Text>
        <Text style={{
          fontFamily: FF.display, fontSize: 84, color: "#F7F7F4",
          marginTop: 10, fontVariant: ["tabular-nums"],
        }}>
          {grace ?? Lockbox.GRACE_SECONDS}
        </Text>
        <Text style={[s.sub, { color: "rgba(247,247,244,0.75)" }]}>
          Your phone left the box. Put it back before this reaches zero or the
          session is forfeited.
        </Text>
        <Text style={{ fontFamily: FF.body, fontSize: 12.5, color: "rgba(247,247,244,0.45)", marginTop: 22 }}>
          {fmt(left)} still to go
        </Text>
      </View>
    );
  }

  if (phase === "active") {
    return (
      <View style={[s.night, { backgroundColor: night }]}>
        <StatusBar barStyle="light-content" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <LockIcon size={14} color="#7FB58F" />
          <Text style={{ fontFamily: FF.kicker, fontSize: 10, letterSpacing: 1.8, color: "#7FB58F" }}>
            IN THE BOX
          </Text>
        </View>
        <Text style={{
          fontFamily: FF.display, fontSize: 68, color: "#F7F7F4",
          fontVariant: ["tabular-nums"], letterSpacing: -1,
        }}>
          {fmt(left)}
        </Text>
        {!!session?.task && (
          <Text style={[s.sub, { color: onNight, marginTop: 6 }]}>{session.task}</Text>
        )}
        <Text style={{ fontFamily: FF.body, fontSize: 12.5, color: "rgba(247,247,244,0.45)", marginTop: 26 }}>
          +{session?.rewardMinutes || 0} minutes when this finishes
        </Text>
        <TouchableOpacity onPress={cancel} style={{ marginTop: 46 }}>
          <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: "rgba(247,247,244,0.5)" }}>
            End early
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === "done") {
    const won = result?.status === "completed";
    return (
      <View style={[s.night, { backgroundColor: won ? night : "#241A16" }]}>
        <StatusBar barStyle="light-content" />
        <Text style={[s.bigSerif, { color: "#F7F7F4" }]}>
          {won ? "Nice." : "Session lost."}
        </Text>
        <Text style={[s.sub, { color: onNight }]}>{Lockbox.describeResult(result)}</Text>
        <TouchableOpacity
          onPress={() => { setResult(null); setSession(null); setPhase("setup"); }}
          style={{ marginTop: 34, backgroundColor: earn.green, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 30 }}
        >
          <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: "#fff" }}>Again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={{ marginTop: 18 }}>
          <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: "rgba(247,247,244,0.5)" }}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // setup
  return (
    <View style={{ flex: 1, backgroundColor: paper.warm, paddingHorizontal: 22, paddingTop: 18 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontFamily: FF.display, fontSize: 26, color: ink.deep, letterSpacing: -0.3 }}>
          Lockbox
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <CloseIcon size={22} color={ink.mid} />
        </TouchableOpacity>
      </View>

      <Text style={{ fontFamily: FF.body, fontSize: 13.5, color: ink.mid, lineHeight: 20, marginTop: 10 }}>
        Put a box on a real surface, set your phone inside, and leave it there.
        Take it out and a countdown starts.
      </Text>

      <Text style={s.kicker(ink)}>HOW LONG</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {DURATIONS.map(m => {
          const on = minutes === m;
          return (
            <TouchableOpacity
              key={m}
              onPress={() => { selectionTick(); setMinutes(m); }}
              style={{
                paddingVertical: 8, paddingHorizontal: 14, borderRadius: 11,
                backgroundColor: on ? earn.green : (dark ? "rgba(232,245,236,0.07)" : paper.sand),
              }}
            >
              <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: on ? "#fff" : ink.mid }}>
                {m >= 60 ? `${m / 60} hr` : `${m} min`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={s.kicker(ink)}>WHAT FOR (OPTIONAL)</Text>
      <TextInput
        value={task}
        onChangeText={setTask}
        placeholder="Studying, reading, dinner…"
        placeholderTextColor={ink.faint}
        maxLength={60}
        style={{
          fontFamily: FF.body, fontSize: 15, color: ink.deep,
          backgroundColor: paper.card, borderRadius: 12,
          paddingHorizontal: 14, paddingVertical: 12,
          borderWidth: 1, borderColor: ink.hairline,
        }}
      />

      <View style={{
        marginTop: 26, borderRadius: 16, padding: 16,
        backgroundColor: paper.card, borderWidth: 1,
        borderColor: dark ? "rgba(232,245,236,0.10)" : ink.hairline,
      }}>
        <Text style={{ fontFamily: FF.bodyBold, fontSize: 14.5, color: ink.deep }}>
          +{Math.max(1, Math.round(minutes * Lockbox.EARN_RATIO))} minutes if you finish
        </Text>
        <Text style={{ fontFamily: FF.body, fontSize: 12.5, color: ink.mid, lineHeight: 18, marginTop: 5 }}>
          Nothing if the phone leaves the box for more than {Lockbox.GRACE_SECONDS} seconds.
          Your screen stays on so Drift can feel it move.
        </Text>
      </View>

      <TouchableOpacity
        onPress={beginPlacement}
        disabled={busy}
        style={{
          marginTop: 22, backgroundColor: earn.green, borderRadius: 14,
          paddingVertical: 15, alignItems: "center", opacity: busy ? 0.5 : 1,
        }}
      >
        {busy ? <ActivityIndicator size="small" color="#fff" /> : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <CheckIcon size={16} color="#fff" />
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: "#fff" }}>
              {ARView ? "Place the box" : "Start"}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      {!ARView && (
        <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint, marginTop: 10, lineHeight: 17 }}>
          AR isn't available here, so there's no box to place — set your phone face
          down somewhere and it works the same.
        </Text>
      )}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  night: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 34 },
  bigSerif: { fontFamily: FF.display, fontSize: 32, textAlign: "center", letterSpacing: -0.4, lineHeight: 40 },
  sub: { fontFamily: FF.body, fontSize: 14, textAlign: "center", lineHeight: 21, marginTop: 12 },
});

// Kept off the StyleSheet object: what create() returns should be treated as
// read-only, and a section label needs the live theme anyway.
const kickerStyle = (ink) => ({
  fontFamily: FF.kicker, fontSize: 9, letterSpacing: 1.6,
  color: ink.faint, marginBottom: 10, marginTop: 26,
});

const s = { ...baseStyles, kicker: kickerStyle };
