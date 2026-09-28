/**
 * LockboxScreen.jsx
 * Lockbox: place a box, put the phone in it, leave it there.
 *
 * PHASES
 *   setup   — choose a length and (optionally) name the task
 *   place   — AR: find a surface, drop the box, adjust it; the phone going
 *             in flat and still starts the session on its own
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
  requireNativeComponent, UIManager, TextInput, Animated, Easing,
  AccessibilityInfo, ScrollView, KeyboardAvoidingView,
} from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import PlantSlider from "./PlantSlider";
import Sprout from "./SproutArt";
import { FF, getTheme } from "./theme";
import { LockIcon } from "./Icons";
import { selectionTick, notify } from "./haptics";
import * as Lockbox from "./lockbox";
import {
  notifyLockboxBreach, notifyLockboxLost, notifyLockboxDone,
  scheduleLockboxLoss, cancelLockboxLoss,
} from "./notifications";

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

export default function LockboxScreen({ dark = false, modePicker = null, onClose, onCompleted, onStarted, onEnded }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const [phase,   setPhase]   = useState("setup");
  const [minutes, setMinutes] = useState(30);
  const [task,    setTask]    = useState("");
  const [session, setSession] = useState(null);
  const [left,    setLeft]    = useState(0);
  const [grace,   setGrace]   = useState(null);
  const [result,  setResult]  = useState(null);
  const [surface, setSurface] = useState(false);   // ghost is on a surface right now
  const [placed,  setPlaced]  = useState(false);
  const [sensed,  setSensed]  = useState(false);   // face down AND still
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
    const needsAwake = ["place", "settle", "locking", "active", "breach"].includes(phase);
    if (needsAwake) activateKeepAwakeAsync().catch(() => {});
    else deactivateKeepAwake();
    return () => deactivateKeepAwake();
  }, [phase]);

  // Leaving Drift mid-session is the same as taking the phone out: we can no
  // longer see the sensors, so we must not pretend the box is still holding.
  useEffect(() => {
    if (!["active", "breach"].includes(phase)) return;
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") return;
      // iOS will not let an app block the home swipe, so the next best thing is
      // that leaving costs exactly what taking the phone out costs — caught the
      // moment it happens, with the countdown following them out of the app
      // rather than ticking away on a screen they can no longer see.
      if (["active", "locking"].includes(phaseRef.current)) {
        markDisturbed();
        notifyLockboxBreach(Lockbox.GRACE_SECONDS).catch(() => {});
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Android hardware back — refuse to drop out of a live session by accident.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (["active", "breach", "settle", "locking"].includes(phaseRef.current)) return true;
      return false;
    });
    return () => sub.remove();
  }, []);

  /**
   * Between placing the box and the session starting, the sensors already know
   * when the phone has gone in: lying flat and completely still. Asking the
   * user to confirm that by tapping a button is asking them to tell us
   * something we can see — and it means the last thing they do before "putting
   * the phone away" is pick it up again.
   *
   * Flat, not face down: the phone goes in screen UP so the countdown is
   * readable from the box, which is the point of keeping the screen awake.
   */
  const watchForEntry = useCallback(async () => {
    unsubRef.current?.();
    unsubRef.current = Lockbox.onStateChange(({ state, flat }) => {
      const inBox = state === "settled" && !!flat;
      setSensed(inBox);
      // Through the ref, never the captured value. This listener is installed
      // once, so calling autoStart directly would pin it to the render that
      // installed it — which is why every session ran for the initial 25
      // minutes no matter what the user picked.
      if (inBox && phaseRef.current === "place") autoStartRef.current?.();
    });
    try { await Lockbox.startMonitoring(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The phone is in. Tear down AR and begin for real.
   *
   * Latched into a ref below, because the sensor listener that fires this is
   * installed once and would otherwise hold the version of this function from
   * the render that installed it — along with the duration selected at that
   * moment, which was always the default.
   */
  const autoStart = useCallback(async () => {
    callAR(arRef.current, "pauseSession");
    unsubRef.current?.();
    setBusy(true);
    try {
      const sess = await Lockbox.startSession({ minutes, task });
      setSession(sess);
      setPhase("locking");          // the seal plays, then hands off to active
      onStarted?.(sess);
      await startMonitoring();
    } catch (e) {
      Alert.alert("Couldn't start", e?.message || "Try again.");
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes, task]);

  const autoStartRef = useRef(null);
  useEffect(() => { autoStartRef.current = autoStart; }, [autoStart]);

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
    // Letting go of the phone jostles it. Neither the settle wait nor the
    // locking animation should be able to register that as a breach.
    if (["settle", "locking"].includes(phaseRef.current)) return;
    if (sessionRef.current?.disturbedAt) return;    // already counting
    const next = await Lockbox.updateSession({
      disturbedAt: Date.now(),
      breaches: (sessionRef.current?.breaches || 0) + 1,
    });
    if (!next) return;
    setSession(next);
    setPhase("breach");
    notify(false);
    // Armed up front: if this breach is "they swiped out", iOS has frozen us
    // and no timer of ours will fire. The deadline has to be the system's.
    scheduleLockboxLoss(Lockbox.GRACE_SECONDS).catch(() => {});
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
    cancelLockboxLoss().catch(() => {});
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
    // Both outcomes can now land while Drift is in the background, so the
    // result has to reach the user somewhere other than this screen.
    if (status === "completed") {
      cancelLockboxLoss().catch(() => {});
      notifyLockboxDone(rec?.rewardMinutes).catch(() => {});
    } else if (status === "forfeited") {
      // The scheduled one may already have fired; same identifier, so this
      // replaces rather than duplicates.
      notifyLockboxLost().catch(() => {});
    } else {
      cancelLockboxLoss().catch(() => {});
    }
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
          onSurfaceFound={({ nativeEvent }) => setSurface(!!nativeEvent?.found)}
          onPlaced={() => {
            notify(true);
            setPlaced(true);
            // AR keeps running after the drop so the box can still be dragged,
            // pinched and turned — it only stops once the phone is actually in
            // (autoStart pauses it), which is a few seconds, not the session.
            watchForEntry();
          }}
          onARError={({ nativeEvent }) => {
            // Do NOT start a session here. Saying "I can't see the room" and
            // then dropping the user into a Lockbox session implies a box was
            // placed when none was — the one thing this screen must not lie
            // about. Offer the two honest options and let them choose.
            setSurface(false);
            setPlaced(false);
            Alert.alert(
              "Couldn't map the room",
              `${nativeEvent?.message || "The camera couldn't find a surface."}\n\nYou can try again, or run the session without the box — it works the same either way.`,
              [
                { text: "Try again", onPress: () => callAR(arRef.current, "reset") },
                { text: "Without the box", onPress: () => { beginSettle(); } },
                { text: "Back", style: "cancel", onPress: () => setPhase("setup") },
              ],
            );
          }}
        />
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 28, paddingHorizontal: 18 }}>
          <View style={arStyles.card}>
            <Text style={arStyles.title}>
              {placed
                ? (sensed ? "Got it — starting" : "Box placed")
                : surface ? "Aim at the spot" : "Looking for a surface"}
            </Text>
            <Text style={arStyles.hint}>
              {placed
                ? "Drag to move · pinch to resize · twist to turn.\nThen set your phone inside, screen up."
                : surface
                  ? "Point where your phone will sit, then drop the box."
                  : "Move your phone slowly over a table or desk."}
            </Text>

            {!placed ? (
              <TouchableOpacity
                onPress={() => { selectionTick(); callAR(arRef.current, "place"); }}
                disabled={!surface}
                activeOpacity={0.85}
                style={[arStyles.primary, { opacity: surface ? 1 : 0.4 }]}
              >
                <Text style={arStyles.primaryText}>Drop the box here</Text>
              </TouchableOpacity>
            ) : (
              // Fallback only. The sensors normally start this themselves; this
              // exists for a phone that will not sit flat.
              <TouchableOpacity
                onPress={autoStart}
                disabled={busy}
                activeOpacity={0.85}
                style={[arStyles.primary, { opacity: busy ? 0.5 : 1 }]}
              >
                <Text style={arStyles.primaryText}>{busy ? "Starting…" : "Start now"}</Text>
              </TouchableOpacity>
            )}

            <View style={{ flexDirection: "row", justifyContent: "center", gap: 28, marginTop: 12 }}>
              {placed ? (
                <TouchableOpacity
                  onPress={() => { setPlaced(false); setSurface(false); unsubRef.current?.(); Lockbox.stopMonitoring(); callAR(arRef.current, "reset"); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={arStyles.quiet}>Start over</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={beginSettle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={arStyles.quiet}>Skip the box</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => { unsubRef.current?.(); Lockbox.stopMonitoring(); setPlaced(false); setSurface(false); setPhase("setup"); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={arStyles.quiet}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (phase === "locking") {
    return <LockSeal onDone={() => setPhase("active")} />;
  }

  if (phase === "settle") {
    return (
      <View style={[s.night, { backgroundColor: night }]}>
        <StatusBar barStyle="light-content" />
        <Text style={[s.bigSerif, { color: "#F7F7F4" }]}>Set your phone{"\n"}down</Text>
        <Text style={[s.sub, { color: onNight }]}>
          Screen up. The session starts once it's completely still.
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

  // setup — same "greenhouse door" layout as the Drift In timer, so switching
  // between the two modes changes the content, not the page.
  const { fx } = theme;
  const reward = Lockbox.rewardFor(minutes);
  const capped = Math.round(minutes * Lockbox.EARN_RATIO) > Lockbox.MAX_REWARD_MINUTES;
  const durLabel = minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim()
    : `${minutes}m`;
  const onDeep = dark ? "#16261C" : "#FAF6EE";

  return (
    <View style={{ flex: 1, backgroundColor: paper.warm }}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />

      <View pointerEvents="none" style={{
        position: "absolute", top: -120, right: -90,
        width: 300, height: 300, borderRadius: 150,
        backgroundColor: fx.auroraMint,
      }} />
      <View pointerEvents="none" style={{
        position: "absolute", bottom: -130, left: -100,
        width: 280, height: 280, borderRadius: 140,
        backgroundColor: fx.auroraClay,
      }} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 24, paddingBottom: 20 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {modePicker}

        <View style={{ marginBottom: 26 }}>
          <Text style={{
            fontFamily: FF.kicker, fontSize: 10, letterSpacing: 2.4,
            color: ink.faint, marginBottom: 6,
          }}>
            PHONE AWAY
          </Text>
          <Text style={{ fontFamily: FF.display, fontSize: 40, color: ink.deep, letterSpacing: -0.4 }}>
            Lockbox
          </Text>
          <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid, lineHeight: 20, marginTop: 8 }}>
            Drop a box on your desk. Phone goes in, and stays in.
          </Text>
        </View>

        <View style={{
          backgroundColor: paper.card,
          borderRadius: 26,
          borderWidth: 1,
          borderColor: ink.border,
          padding: 22,
          overflow: "hidden",
        }}>
          <View pointerEvents="none" style={{
            position: "absolute", right: -18, top: -14,
            opacity: dark ? 0.10 : 0.08,
          }}>
            <Sprout size={110} tone={dark ? "night" : "fresh"} />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <Text style={[s.fieldKicker(ink), { marginBottom: 0 }]}>LENGTH</Text>
            <Text style={{ fontFamily: FF.display, fontSize: 24, color: ink.deep, letterSpacing: -0.4 }}>
              {durLabel}
            </Text>
          </View>
          <PlantSlider
            minimumValue={15}
            maximumValue={300}
            step={15}
            value={minutes}
            onValueChange={setMinutes}
            accent={earn.sage}
            track={ink.ghost}
            soil={ink.border}
            textColor={ink.faint}
            leftLabel="15m"
            rightLabel="5h"
          />

          <View style={s.divider(ink)} />

          <Text style={s.fieldKicker(ink)}>YOU'LL EARN</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FF.display, fontSize: 26, color: earn.sage, letterSpacing: -0.4 }}>
                {reward}m
              </Text>
              <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                {capped ? "screen time (max)" : "screen time"}
              </Text>
            </View>
            <View style={{ width: 1, height: 36, backgroundColor: ink.hairline, marginHorizontal: 16 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FF.display, fontSize: 26, color: earn.clay, letterSpacing: -0.4 }}>
                {Lockbox.GRACE_SECONDS}s
              </Text>
              <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                to put it back
              </Text>
            </View>
          </View>
        </View>

        {!ARView && (
          <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint, marginTop: 14, lineHeight: 17, textAlign: "center" }}>
            No AR on this device — just set your phone down flat.
          </Text>
        )}
      </ScrollView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
      >
        <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 14 }}>
          <View style={{
            backgroundColor: paper.card,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: ink.border,
            padding: 14,
          }}>
            <TextInput
              value={task}
              onChangeText={setTask}
              placeholder="What for? (optional)"
              placeholderTextColor={ink.faint}
              maxLength={60}
              returnKeyType="done"
              style={{
                backgroundColor: paper.sand,
                borderRadius: 16,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontFamily: FF.bodyMed,
                fontSize: 15,
                color: ink.deep,
              }}
            />
            <TouchableOpacity
              onPress={beginPlacement}
              disabled={busy}
              activeOpacity={0.85}
              style={[
                {
                  height: 54, borderRadius: 18, marginTop: 10,
                  alignItems: "center", justifyContent: "center",
                  flexDirection: "row", gap: 9,
                  backgroundColor: earn.deep, opacity: busy ? 0.5 : 1,
                },
                fx.glow,
              ]}
            >
              {busy ? <ActivityIndicator size="small" color={onDeep} /> : (
                <>
                  <LockIcon size={15} color={onDeep} />
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, letterSpacing: 0.2, color: onDeep }}>
                    {ARView ? "Place the box" : "Start"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * The moment the box seals.
 *
 * Arch drops into the body, one dull haptic on the contact, a ring pushes
 * outward from it. Deliberately closer to a latch than a fanfare — this is a
 * phone being put away, and a celebration would be the wrong register for the
 * next hour of not touching it.
 *
 * Everything is transform and opacity so it all runs on the native driver;
 * nothing here should contend with the JS thread while the shield is applied.
 */
function LockSeal({ onDone }) {
  const body    = useRef(new Animated.Value(0)).current;  // scale/fade in
  const shackle = useRef(new Animated.Value(0)).current;  // drops closed
  const ring    = useRef(new Animated.Value(0)).current;  // outward pulse
  const label   = useRef(new Animated.Value(0)).current;
  const wash    = useRef(new Animated.Value(0)).current;
  const [reduce, setReduce] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
  }, []);

  useEffect(() => {
    const finish = () => { if (!done.current) { done.current = true; onDone?.(); } };

    if (reduce) {
      Animated.timing(wash, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      [body, shackle, label].forEach(v => v.setValue(1));
      notify(true);
      const t = setTimeout(finish, 900);
      return () => clearTimeout(t);
    }

    Animated.sequence([
      Animated.parallel([
        Animated.timing(wash, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.spring(body, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }),
      ]),
      // The shackle falling is the beat everything else hangs off.
      Animated.timing(shackle, {
        toValue: 1, duration: 320,
        easing: Easing.bezier(0.5, 0, 0.75, 0),   // accelerates into the body
        useNativeDriver: true,
      }),
    ]).start(() => {
      notify(true);                                // the clunk, on contact
      Animated.parallel([
        Animated.timing(ring, {
          toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(label, {
          toValue: 1, delay: 90, duration: 340,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]).start(() => setTimeout(finish, 620));
    });
  }, [reduce, body, shackle, ring, label, wash, onDone]);

  return (
    <Animated.View style={[s.night, { backgroundColor: "#0B1A11", opacity: wash }]}>
      <StatusBar barStyle="light-content" />

      <View style={{ width: 150, height: 150, alignItems: "center", justifyContent: "center" }}>
        {/* Ring pushed outward by the latch closing */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute", width: 108, height: 108, borderRadius: 54,
            borderWidth: 2, borderColor: "#4DFF99",
            opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.9] }) }],
          }}
        />

        <Animated.View style={{
          alignItems: "center",
          opacity: body,
          transform: [{ scale: body.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) }],
        }}>
          {/* Shackle — an arch that drops into the body */}
          <Animated.View style={{
            width: 42, height: 34,
            borderWidth: 5, borderBottomWidth: 0,
            borderColor: "#4DFF99",
            borderTopLeftRadius: 21, borderTopRightRadius: 21,
            transform: [{
              translateY: shackle.interpolate({ inputRange: [0, 1], outputRange: [-13, 6] }),
            }],
          }} />
          {/* Body */}
          <View style={{
            width: 68, height: 54, borderRadius: 13,
            backgroundColor: "#4DFF99",
            alignItems: "center", justifyContent: "center",
          }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#0B1A11" }} />
            <View style={{ width: 4, height: 11, backgroundColor: "#0B1A11", marginTop: -1 }} />
          </View>
        </Animated.View>
      </View>

      <Animated.Text style={{
        fontFamily: FF.display, fontSize: 30, color: "#F7F7F4",
        letterSpacing: -0.3, marginTop: 22,
        opacity: label,
        transform: [{ translateY: label.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}>
        Locked
      </Animated.Text>
      <Animated.Text style={{
        fontFamily: FF.body, fontSize: 13.5, color: "rgba(247,247,244,0.6)",
        marginTop: 8, opacity: label,
      }}>
        Leave it where it is.
      </Animated.Text>
    </Animated.View>
  );
}

const baseStyles = StyleSheet.create({
  night: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 34 },
  bigSerif: { fontFamily: FF.display, fontSize: 32, textAlign: "center", letterSpacing: -0.4, lineHeight: 40 },
  sub: { fontFamily: FF.body, fontSize: 14, textAlign: "center", lineHeight: 21, marginTop: 12 },
});

// Kept off the StyleSheet object: what create() returns should be treated as
// read-only, and a section label needs the live theme anyway.
// Mirrors DriftInScreen's helpers so the two setup pages are typographically
// identical.
const fieldKicker = (ink) => ({
  fontFamily: FF.kicker, fontSize: 9, color: ink.faint,
  letterSpacing: 2.4, marginBottom: 10,
});
const divider = (ink) => ({
  height: 1, backgroundColor: ink.hairline, marginVertical: 20,
});

const s = { ...baseStyles, fieldKicker, divider };

// The AR overlay sits on a live camera feed, so it is always dark glass
// regardless of the app theme — light paper over a camera image is unreadable.
const arStyles = StyleSheet.create({
  card: {
    borderRadius: 24, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
    backgroundColor: "rgba(10,18,14,0.72)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  title: { fontFamily: FF.bodyBold, fontSize: 16, color: "#F7F7F4", textAlign: "center" },
  hint: {
    fontFamily: FF.body, fontSize: 13, lineHeight: 19, color: "rgba(247,247,244,0.66)",
    textAlign: "center", marginTop: 5,
  },
  primary: {
    height: 50, borderRadius: 16, marginTop: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#F7F7F4",
  },
  primaryText: { fontFamily: FF.bodyMed, fontSize: 15, color: "#0B1A11" },
  quiet: { fontFamily: FF.bodyMed, fontSize: 13.5, color: "rgba(247,247,244,0.6)" },
});
