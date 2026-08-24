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
import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, Modal, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, Platform,
} from "react-native";
import { FF, getTheme } from "./theme";
import { CloseIcon, CheckIcon, MicIcon } from "./Icons";
import * as SleepGuard from "./sleepGuard";

const REWARD_CHOICES = [15, 30, 45, 60];
const REMINDER_CHOICES = [
  { h: 21, m: 0,  label: "9:00 PM" },
  { h: 21, m: 45, label: "9:45 PM" },
  { h: 22, m: 30, label: "10:30 PM" },
  { h: 23, m: 0,  label: "11:00 PM" },
];

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

  const pickReward = async (mins) => {
    setReward(mins);
    await SleepGuard.setPrefs({ rewardMinutes: mins });
    onChanged?.();
  };

  const pickReminder = async (c) => {
    setReminder({ h: c.h, m: c.m });
    await SleepGuard.setPrefs({ reminderHour: c.h, reminderMinute: c.m });
    onChanged?.();
  };

  const chip = (active) => ({
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 11,
    backgroundColor: active ? earn.green : (dark ? "rgba(232,245,236,0.07)" : paper.sand),
    borderWidth: 1,
    borderColor: active ? earn.green : "transparent",
  });
  const chipText = (active) => ({
    fontFamily: FF.bodyMed, fontSize: 13,
    color: active ? "#fff" : ink.mid,
  });
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

              <Text style={kicker}>REWARD FOR A FULL NIGHT</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {REWARD_CHOICES.map(m => (
                  <TouchableOpacity key={m} onPress={() => pickReward(m)} style={chip(reward === m)}>
                    <Text style={chipText(reward === m)}>{m} min</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={kicker}>NIGHTLY REMINDER</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {REMINDER_CHOICES.map(c => {
                  const active = reminder.h === c.h && reminder.m === c.m;
                  return (
                    <TouchableOpacity key={c.label} onPress={() => pickReminder(c)} style={chip(active)}>
                      <Text style={chipText(active)}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint, marginTop: 8, lineHeight: 17 }}>
                Only sent once a tag is registered, and skipped on nights you've
                already tapped in.
              </Text>

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
