/**
 * SleepGuardModal.jsx
 * Settings for the "phone in another room" overnight guard.
 *
 * WHY THIS EXISTS
 * The nightly flow lives entirely on the Today card — tap the tag, sleep, see
 * the result. That is deliberate: at bedtime you want one tap, not a settings
 * screen. But it left the feature with no way OUT. Once a tag was registered
 * there was no way to change it, forget it, or turn the guard off, which is the
 * kind of one-way door that generates support mail.
 *
 * So this screen is the rare half: setup, reconfiguration, and off. It is not
 * where you arm a night.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, Modal, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, Platform,
} from "react-native";
import { FF, getTheme } from "./theme";
import { CloseIcon, CheckIcon, MicIcon } from "./Icons";
import PlantSlider from "./PlantSlider";
import * as SleepGuard from "./sleepGuard";

// Sliders, not a menu of four arbitrary times. Reward keeps the old 15–60 min
// bounds. The reminder runs 8 PM → 1 AM on a timeline that continues past
// midnight (minutes after 00:00, +1440 once past it) so it is one straight line.
const REWARD_MIN = 15, REWARD_MAX = 60, REWARD_STEP = 5;
const REMIND_MIN = 20 * 60, REMIND_MAX = 25 * 60, REMIND_STEP = 15;
const toTimeline = ({ h, m }) => {
  const v = (h % 24) * 60 + m;
  return Math.max(REMIND_MIN, Math.min(REMIND_MAX, v < 12 * 60 ? v + 1440 : v));
};
const clockLabel = (v) => {
  const n = v % 1440, h = Math.floor(n / 60), m = n % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

export default function SleepGuardModal({ visible, dark = false, onClose, onChanged }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const [tag,      setTag]      = useState(null);
  const [streak,   setStreak]   = useState(0);
  const [history,  setHistory]  = useState([]);
  const [reward,   setReward]   = useState(30);
  const [reminder, setReminder] = useState({ h: 21, m: 45 });
  const [busy,     setBusy]     = useState(false);
  const [loading,  setLoading]  = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s, h, prefs] = await Promise.all([
        SleepGuard.getRegisteredTag(),
        SleepGuard.getStreak(),
        SleepGuard.getHistory(),
        SleepGuard.getPrefs(),
      ]);
      setTag(t);
      setStreak(s);
      setHistory(h.slice(-7).reverse());
      setReward(prefs.rewardMinutes);
      setReminder({ h: prefs.reminderHour, m: prefs.reminderMinute });
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { if (visible) refresh(); }, [visible, refresh]);

  const register = async () => {
    setBusy(true);
    try {
      const motion = await SleepGuard.requestMotionAuth();
      if (motion !== "authorized") {
        Alert.alert(
          "Motion access needed",
          "Drift uses Motion & Fitness to check your phone stayed still overnight. Turn it on in Settings › Drift › Motion & Fitness.",
        );
        return;
      }
      const id = await SleepGuard.registerTag();
      setTag(id);
      onChanged?.();
      Alert.alert("Tag saved", "Leave it in the room where your phone will sleep. Tap it at bedtime to start a night.");
    } catch (e) {
      if (e?.code !== "cancelled" && e?.message !== "cancelled") {
        Alert.alert("Couldn't read that tag", "Hold your phone still against the tag and try again.");
      }
    } finally { setBusy(false); }
  };

  // Destructive, so it asks. Clearing the tag also cancels any armed night —
  // leaving one armed against a tag that no longer exists would strand the
  // user with their apps blocked and no way to settle it.
  const forget = () => {
    Alert.alert(
      "Turn off sleep guard?",
      "Drift will forget your tag and stop the nightly reminder. Your streak history is kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn off",
          style: "destructive",
          onPress: async () => {
            await SleepGuard.clearTag();
            setTag(null);
            onChanged?.();
          },
        },
      ],
    );
  };

  // A slider fires on every step; persist (and let the parent reschedule the
  // reminder) once the thumb comes to rest, not on each tick.
  const saveTimer = useRef(null);
  const persistSoon = (patch) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await SleepGuard.setPrefs(patch);
      onChanged?.();
    }, 400);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const pickReward = (mins) => {
    setReward(mins);
    persistSoon({ rewardMinutes: mins });
  };

  const pickReminder = (v) => {
    const n = v % 1440;
    const next = { h: Math.floor(n / 60), m: n % 60 };
    setReminder(next);
    persistSoon({ reminderHour: next.h, reminderMinute: next.m });
  };

  const sliderHead = (label, value) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
      <Text style={{ fontFamily: FF.kicker, fontSize: 9, letterSpacing: 2.4, color: ink.faint }}>{label}</Text>
      <Text style={{ fontFamily: FF.display, fontSize: 22, color: ink.deep, letterSpacing: -0.3 }}>{value}</Text>
    </View>
  );
  const kicker = {
    fontFamily: FF.kicker, fontSize: 9, letterSpacing: 1.6,
    color: ink.faint, marginBottom: 10, marginTop: 26,
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        <View style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10,
        }}>
          <Text style={{ fontFamily: FF.display, fontSize: 24, color: ink.deep, letterSpacing: -0.3 }}>
            Sleep guard
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <CloseIcon size={22} color={ink.mid} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
          <Text style={{ fontFamily: FF.body, fontSize: 13.5, color: ink.mid, lineHeight: 20 }}>
            Stick an NFC tag in another room. Tap it at bedtime and Drift blocks
            your apps until morning, then checks your phone actually stayed there.
          </Text>

          {loading ? (
            <ActivityIndicator color={earn.sage} style={{ marginTop: 40 }} />
          ) : (
            <>
              <Text style={kicker}>YOUR TAG</Text>
              <View style={{
                borderRadius: 16, padding: 16,
                backgroundColor: paper.card,
                borderWidth: 1, borderColor: dark ? "rgba(232,245,236,0.10)" : ink.hairline,
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <MicIcon size={18} color={tag ? earn.green : ink.faint} />
                  <Text style={{ fontFamily: FF.bodyBold, fontSize: 14.5, color: ink.deep }}>
                    {tag ? "Tag registered" : "No tag yet"}
                  </Text>
                </View>
                <Text style={{ fontFamily: FF.body, fontSize: 12.5, color: ink.mid, lineHeight: 18 }}>
                  {tag
                    ? (streak > 0
                        ? `${streak} night${streak === 1 ? "" : "s"} in a row.`
                        : "Tap it at bedtime to start your first night.")
                    : "Register a tag to turn the guard on."}
                </Text>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  <TouchableOpacity
                    onPress={register}
                    disabled={busy}
                    style={{
                      paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12,
                      backgroundColor: earn.green, opacity: busy ? 0.5 : 1,
                    }}
                  >
                    {busy
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: "#fff" }}>
                          {tag ? "Scan a different tag" : "Register a tag"}
                        </Text>}
                  </TouchableOpacity>
                  {tag && (
                    <TouchableOpacity
                      onPress={forget}
                      style={{
                        paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12,
                        borderWidth: 1, borderColor: ink.hairline,
                      }}
                    >
                      <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: ink.mid }}>Turn off</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={{
                marginTop: 18, borderRadius: 24, padding: 20,
                backgroundColor: paper.card,
                borderWidth: 1, borderColor: ink.border,
              }}>
                {sliderHead("REWARD PER NIGHT", `${reward} min`)}
                <PlantSlider
                  minimumValue={REWARD_MIN}
                  maximumValue={REWARD_MAX}
                  step={REWARD_STEP}
                  value={Math.max(REWARD_MIN, Math.min(REWARD_MAX, reward))}
                  onValueChange={pickReward}
                  accent={earn.sage} track={ink.ghost} soil={ink.border} textColor={ink.faint}
                  leftLabel={`${REWARD_MIN}m`} rightLabel={`${REWARD_MAX}m`}
                />

                <View style={{ height: 1, backgroundColor: ink.hairline, marginVertical: 18 }} />

                {sliderHead("BEDTIME REMINDER", clockLabel(toTimeline(reminder)))}
                <PlantSlider
                  minimumValue={REMIND_MIN}
                  maximumValue={REMIND_MAX}
                  step={REMIND_STEP}
                  value={toTimeline(reminder)}
                  onValueChange={pickReminder}
                  accent={earn.sage} track={ink.ghost} soil={ink.border} textColor={ink.faint}
                  leftLabel="8 PM" rightLabel="1 AM"
                />
                <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint, marginTop: 10 }}>
                  Skipped on nights you've already tapped in.
                </Text>
              </View>

              {history.length > 0 && (
                <>
                  <Text style={kicker}>RECENT NIGHTS</Text>
                  <View style={{
                    borderRadius: 16, overflow: "hidden",
                    borderWidth: 1, borderColor: dark ? "rgba(232,245,236,0.10)" : ink.hairline,
                  }}>
                    {history.map((n, i) => (
                      <View key={n.startedAt} style={{
                        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                        paddingVertical: 11, paddingHorizontal: 14,
                        backgroundColor: paper.card,
                        borderTopWidth: i === 0 ? 0 : 1,
                        borderTopColor: ink.hairline,
                      }}>
                        <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid }}>{n.date}</Text>
                        <Text style={{
                          fontFamily: FF.bodyMed, fontSize: 12.5,
                          color: n.status === "success" ? earn.green : ink.faint,
                        }}>
                          {n.status === "success" ? `+${n.rewardMinutes}m` :
                           n.status === "moved" ? "moved" : n.status}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
