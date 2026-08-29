/**
 * ActionPlanModal.jsx
 * Build a written plan for cutting your own screen time.
 *
 * SHAPE: one scrolling form, not a wizard. A plan is something you come back
 * and revise — a five-step flow is fine the first time and hostile every time
 * after, because changing one answer means walking the whole thing again. Here
 * every answer is visible at once and the summary at the bottom recomputes as
 * you tap.
 *
 * The summary is the point of the screen. Drift caps rewards at half a task's
 * length, so an hour of scrolling costs two hours of tasks — an exchange rate
 * most people have never seen written down. Showing it is usually what turns
 * "I should use my phone less" into an actual decision.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, Modal, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
} from "react-native";
import { FF, getTheme } from "./theme";
import { CloseIcon, CheckIcon } from "./Icons";
import * as Plan from "./actionPlan";

const BASELINES = [60, 120, 180, 240, 300, 420];
const REDUCTIONS = [0.25, 0.4, 0.5];
const PHONE_DOWN = [
  { h: 21, m: 0 }, { h: 21, m: 45 }, { h: 22, m: 30 }, { h: 23, m: 0 },
];

export default function ActionPlanModal({
  visible, dark = false, userId, todaySpentMinutes = 0,
  onClose, onApply,
}) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const [plan, setPlan] = useState(Plan.DEFAULT_PLAN);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existed, setExisted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const saved = await Plan.getPlan(userId);
      if (saved) {
        setPlan(saved);
        setExisted(true);
      } else {
        // Seed the baseline from what they've actually spent today when there
        // is a figure — a real number they recognise beats a generic default,
        // and it is the only usage Drift can honestly claim to know.
        const seed = todaySpentMinutes > 15
          ? BASELINES.reduce((best, b) =>
              Math.abs(b - todaySpentMinutes) < Math.abs(best - todaySpentMinutes) ? b : best,
            BASELINES[0])
          : Plan.DEFAULT_PLAN.baselineMinutes;
        setPlan({
          ...Plan.DEFAULT_PLAN,
          baselineMinutes: seed,
          targetMinutes: Math.round(seed * 0.6 / 15) * 15,
        });
        setExisted(false);
      }
    } catch {} finally { setLoading(false); }
  }, [userId, todaySpentMinutes]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const d = useMemo(() => Plan.derivePlan(plan), [plan]);

  const set = (patch) => setPlan(p => ({ ...p, ...patch }));

  const pickBaseline = (mins) => {
    // Keep the target at or below the new baseline, preserving the ratio they
    // had chosen rather than snapping it to a default they did not pick.
    const ratio = plan.baselineMinutes > 0 ? plan.targetMinutes / plan.baselineMinutes : 0.6;
    set({
      baselineMinutes: mins,
      targetMinutes: Math.min(mins, Math.round((mins * ratio) / 15) * 15),
    });
  };

  const toggleSwap = (key) => {
    const has = (plan.swaps || []).includes(key);
    set({ swaps: has ? plan.swaps.filter(s => s !== key) : [...(plan.swaps || []), key] });
  };

  const apply = async () => {
    if (d.savedPerDay <= 0) {
      Alert.alert(
        "Pick a lower target",
        "Your target is the same as your baseline, so there's nothing to change yet.",
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await Plan.savePlan(userId, plan);
      await onApply?.(saved, Plan.suggestedRules(saved));
      onClose?.();
    } catch (e) {
      Alert.alert("Couldn't save your plan", e?.message || "Try again.");
    } finally { setSaving(false); }
  };

  const remove = () => {
    Alert.alert(
      "Delete this plan?",
      "Your blocked hours and reminder stay as they are. Only the plan is removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => { await Plan.clearPlan(userId); onApply?.(null, null); onClose?.(); },
        },
      ],
    );
  };

  const chip = (active) => ({
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 11,
    backgroundColor: active ? earn.green : (dark ? "rgba(232,245,236,0.07)" : paper.sand),
    borderWidth: 1, borderColor: active ? earn.green : "transparent",
  });
  const chipText = (active) => ({
    fontFamily: FF.bodyMed, fontSize: 13, color: active ? "#fff" : ink.mid,
  });
  const kicker = {
    fontFamily: FF.kicker, fontSize: 9, letterSpacing: 1.6,
    color: ink.faint, marginBottom: 10, marginTop: 26,
  };
  const help = {
    fontFamily: FF.body, fontSize: 12, color: ink.faint, marginTop: 8, lineHeight: 17,
  };
  const row = { flexDirection: "row", gap: 8, flexWrap: "wrap" };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        <View style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10,
        }}>
          <Text style={{ fontFamily: FF.display, fontSize: 24, color: ink.deep, letterSpacing: -0.3 }}>
            Action plan
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <CloseIcon size={22} color={ink.mid} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 56 }}>
          <Text style={{ fontFamily: FF.body, fontSize: 13.5, color: ink.mid, lineHeight: 20 }}>
            Five answers, and Drift turns them into a target you can actually hold
            yourself to — with the hours to back it up.
          </Text>

          {loading ? (
            <ActivityIndicator color={earn.sage} style={{ marginTop: 40 }} />
          ) : (
            <>
              <Text style={kicker}>ON A TYPICAL DAY, I SPEND</Text>
              <View style={row}>
                {BASELINES.map(m => (
                  <TouchableOpacity key={m} onPress={() => pickBaseline(m)} style={chip(plan.baselineMinutes === m)}>
                    <Text style={chipText(plan.baselineMinutes === m)}>{Plan.formatDuration(m)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={help}>
                On the apps you've blocked, not your whole phone. A rough figure is
                fine — this is the number you're trying to move.
              </Text>

              <Text style={kicker}>I WANT THAT DOWN TO</Text>
              <View style={row}>
                {REDUCTIONS.map(r => {
                  const target = Math.round((plan.baselineMinutes * (1 - r)) / 15) * 15;
                  const active = plan.targetMinutes === target;
                  return (
                    <TouchableOpacity key={r} onPress={() => set({ targetMinutes: target })} style={chip(active)}>
                      <Text style={chipText(active)}>
                        {Plan.formatDuration(target)}
                        <Text style={{ opacity: 0.75 }}>{`  −${Math.round(r * 100)}%`}</Text>
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={kicker}>PHONE DOWN BY</Text>
              <View style={row}>
                {PHONE_DOWN.map(t => {
                  const active = plan.phoneDownHour === t.h && plan.phoneDownMinute === t.m;
                  return (
                    <TouchableOpacity
                      key={`${t.h}:${t.m}`}
                      onPress={() => set({ phoneDownHour: t.h, phoneDownMinute: t.m })}
                      style={chip(active)}
                    >
                      <Text style={chipText(active)}>{Plan.formatClock(t.h, t.m)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={kicker}>HARDEST STRETCH OF THE DAY</Text>
              <View style={row}>
                {Plan.HARDEST.map(h => (
                  <TouchableOpacity key={h.key} onPress={() => set({ hardest: h.key })} style={chip(plan.hardest === h.key)}>
                    <Text style={chipText(plan.hardest === h.key)}>{h.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={kicker}>INSTEAD, I'LL</Text>
              <View style={row}>
                {Plan.SWAPS.map(s => {
                  const active = (plan.swaps || []).includes(s.key);
                  return (
                    <TouchableOpacity key={s.key} onPress={() => toggleSwap(s.key)} style={chip(active)}>
                      <Text style={chipText(active)}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={help}>Optional. Pick as many as you like.</Text>

              {/* ── The plan itself ── */}
              <Text style={kicker}>YOUR PLAN</Text>
              <View style={{
                borderRadius: 16, padding: 18,
                backgroundColor: paper.card,
                borderWidth: 1, borderColor: dark ? "rgba(232,245,236,0.10)" : ink.hairline,
              }}>
                <Text style={{
                  fontFamily: FF.display, fontSize: 19, color: ink.deep,
                  lineHeight: 26, letterSpacing: -0.2,
                }}>
                  {d.savedPerDay > 0
                    ? `${Plan.formatDuration(d.target)} a day — ${Plan.formatDuration(d.savedPerDay)} less than now.`
                    : "Pick a target below your baseline to build a plan."}
                </Text>

                {d.savedPerDay > 0 && (
                  <>
                    <View style={{ height: 1, backgroundColor: ink.hairline, marginVertical: 14 }} />
                    <PlanLine
                      theme={theme}
                      label="To earn it"
                      value={`${Plan.formatDuration(d.dailyTaskMinutes)} of tasks a day`}
                    />
                    <PlanLine
                      theme={theme}
                      label="Apps lock"
                      value={`${d.phoneDownLabel} – 6:00 AM${
                        Plan.HARDEST.find(h => h.key === plan.hardest)?.window
                          ? `, plus ${Plan.HARDEST.find(h => h.key === plan.hardest).label.toLowerCase()}`
                          : ""
                      }`}
                    />
                    <PlanLine
                      theme={theme}
                      label="That's"
                      value={`${d.weeklyHoursSaved} hrs a week, ${d.yearlyDaysSaved} days a year`}
                    />
                    <Text style={{
                      fontFamily: FF.body, fontSize: 12.5, color: ink.mid,
                      lineHeight: 18, marginTop: 14,
                    }}>
                      Drift pays half a task's length in screen time, so
                      {" "}{Plan.formatDuration(d.target)} costs
                      {" "}{Plan.formatDuration(d.dailyTaskMinutes)} of real work. That
                      exchange rate is the whole point.
                    </Text>
                  </>
                )}
              </View>

              <TouchableOpacity
                onPress={apply}
                disabled={saving || d.savedPerDay <= 0}
                style={{
                  marginTop: 18, borderRadius: 14, paddingVertical: 15,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: earn.green,
                  opacity: (saving || d.savedPerDay <= 0) ? 0.45 : 1,
                }}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <CheckIcon size={16} color="#fff" />
                      <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: "#fff" }}>
                        {existed ? "Update my plan" : "Start this plan"}
                      </Text>
                    </View>
                  )}
              </TouchableOpacity>
              <Text style={help}>
                Applying sets those blocked hours and moves your bedtime reminder to
                match. Your existing windows are kept.
              </Text>

              {existed && (
                <TouchableOpacity onPress={remove} style={{ marginTop: 18, alignItems: "center" }}>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: ink.faint }}>
                    Delete this plan
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function PlanLine({ theme, label, value }) {
  const { ink } = theme;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 14, paddingVertical: 5 }}>
      <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, flexShrink: 0 }}>{label}</Text>
      <Text style={{
        fontFamily: FF.bodyMed, fontSize: 13, color: ink.deep,
        textAlign: "right", flexShrink: 1,
      }}>
        {value}
      </Text>
    </View>
  );
}
