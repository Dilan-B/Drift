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
 * Numbers are sliders, not chip rows: a fixed menu of "1 hr, 2 hr, 3 hr, 5 hr,
 * 7 hr" never contains the user's actual figure, and a wall of chips plus a
 * help paragraph under each one was more reading than deciding. Copy is kept to
 * labels; the summary card carries the explanation by showing the numbers.
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
import PlantSlider from "./PlantSlider";
import { selectionTick } from "./haptics";
import * as Plan from "./actionPlan";

// Slider ranges, in minutes. Baseline tops out at 10 hours — above that the
// slider's precision near the common 2–5h range gets too coarse to use.
const BASELINE_MIN = 30;
const BASELINE_MAX = 600;
// Phone-down runs 7 PM → 1 AM, expressed as minutes after midnight on a
// timeline that continues past 24:00 so the slider is one straight line.
const DOWN_MIN = 19 * 60;
const DOWN_MAX = 25 * 60;
const STEP = 15;
const snap = (n) => Math.round(n / STEP) * STEP;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
          ? clamp(snap(todaySpentMinutes), BASELINE_MIN, BASELINE_MAX)
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
      targetMinutes: Math.min(mins, snap(mins * ratio)),
    });
  };

  // Phone-down on the continuous 19:00–25:00 timeline, and back.
  const downValue = (() => {
    const m = (plan.phoneDownHour % 24) * 60 + (plan.phoneDownMinute || 0);
    return clamp(m < 12 * 60 ? m + 1440 : m, DOWN_MIN, DOWN_MAX);
  })();
  const setDown = (v) => {
    const m = v % 1440;
    set({ phoneDownHour: Math.floor(m / 60), phoneDownMinute: m % 60 });
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

  const pill = (active) => ({
    paddingVertical: 8, paddingHorizontal: 13, borderRadius: 11,
    backgroundColor: active ? earn.green : (dark ? "rgba(232,245,236,0.07)" : paper.sand),
  });
  const pillText = (active) => ({
    fontFamily: FF.bodyMed, fontSize: 13, color: active ? "#fff" : ink.mid,
  });
  const card = {
    backgroundColor: paper.card, borderRadius: 24, padding: 20,
    borderWidth: 1, borderColor: ink.border, marginTop: 18,
  };
  const divider = { height: 1, backgroundColor: ink.hairline, marginVertical: 18 };
  const onDeep = dark ? "#16261C" : "#FAF6EE";
  const hardest = Plan.HARDEST.find(h => h.key === plan.hardest);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        <View style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4,
        }}>
          <Text style={{ fontFamily: FF.display, fontSize: 28, color: ink.deep, letterSpacing: -0.3 }}>
            Action plan
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <CloseIcon size={22} color={ink.mid} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
          <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid, lineHeight: 20 }}>
            Set a goal. Drift turns it into a plan.
          </Text>

          {loading ? (
            <ActivityIndicator color={earn.sage} style={{ marginTop: 40 }} />
          ) : (
            <>
              {/* ── The numbers ── */}
              <View style={card}>
                <Field theme={theme} label="I SPEND ABOUT" value={`${Plan.formatDuration(plan.baselineMinutes)}/day`} />
                <PlantSlider
                  minimumValue={BASELINE_MIN}
                  maximumValue={BASELINE_MAX}
                  step={STEP}
                  value={clamp(plan.baselineMinutes, BASELINE_MIN, BASELINE_MAX)}
                  onValueChange={pickBaseline}
                  accent={earn.sage} track={ink.ghost} soil={ink.border} textColor={ink.faint}
                  leftLabel="30m" rightLabel="10h"
                />

                <View style={divider} />

                <Field
                  theme={theme}
                  label="GOAL"
                  value={Plan.formatDuration(d.target)}
                  badge={d.reductionPct > 0 ? `−${d.reductionPct}%` : null}
                />
                <PlantSlider
                  minimumValue={0}
                  maximumValue={plan.baselineMinutes}
                  step={STEP}
                  value={clamp(plan.targetMinutes, 0, plan.baselineMinutes)}
                  onValueChange={(v) => set({ targetMinutes: v })}
                  accent={earn.sage} track={ink.ghost} soil={ink.border} textColor={ink.faint}
                  leftLabel="0" rightLabel={Plan.formatDuration(plan.baselineMinutes)}
                />

                <View style={divider} />

                <Field theme={theme} label="PHONE DOWN BY" value={d.phoneDownLabel} />
                <PlantSlider
                  minimumValue={DOWN_MIN}
                  maximumValue={DOWN_MAX}
                  step={STEP}
                  value={downValue}
                  onValueChange={setDown}
                  accent={earn.sage} track={ink.ghost} soil={ink.border} textColor={ink.faint}
                  leftLabel="7 PM" rightLabel="1 AM"
                />
              </View>

              {/* ── Hardest stretch: one segmented row, single choice ── */}
              <Text style={kickerStyle(ink)}>HARDEST TIME</Text>
              <View style={{
                flexDirection: "row", gap: 4, padding: 4, borderRadius: 13,
                backgroundColor: dark ? "rgba(232,245,236,0.06)" : paper.sand,
              }}>
                {Plan.HARDEST.map(h => {
                  const on = plan.hardest === h.key;
                  return (
                    <TouchableOpacity
                      key={h.key}
                      onPress={() => { selectionTick(); set({ hardest: h.key }); }}
                      style={{
                        flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center",
                        backgroundColor: on ? paper.card : "transparent",
                      }}
                    >
                      <Text style={{ fontFamily: on ? FF.bodyMed : FF.body, fontSize: 13, color: on ? ink.deep : ink.mid }}>
                        {h.short}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── Swaps: multi-select, so these stay as pills ── */}
              <Text style={kickerStyle(ink)}>INSTEAD, I'LL  <Text style={{ opacity: 0.6 }}>(OPTIONAL)</Text></Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {Plan.SWAPS.map(s => {
                  const active = (plan.swaps || []).includes(s.key);
                  return (
                    <TouchableOpacity key={s.key} onPress={() => { selectionTick(); toggleSwap(s.key); }} style={pill(active)}>
                      <Text style={pillText(active)}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── The plan itself ── */}
              <View style={card}>
                <Text style={{ fontFamily: FF.kicker, fontSize: 9, letterSpacing: 2.4, color: ink.faint }}>
                  YOUR PLAN
                </Text>
                {d.savedPerDay > 0 ? (
                  <>
                    <Text style={{ fontFamily: FF.display, fontSize: 26, color: ink.deep, letterSpacing: -0.4, marginTop: 8 }}>
                      {Plan.formatDuration(d.target)} a day
                    </Text>
                    <Text style={{ fontFamily: FF.body, fontSize: 13, color: earn.sage, marginTop: 2 }}>
                      {Plan.formatDuration(d.savedPerDay)} less than now
                    </Text>
                    <View style={divider} />
                    <PlanLine theme={theme} label="Tasks to earn it" value={`${Plan.formatDuration(d.dailyTaskMinutes)}/day`} />
                    <PlanLine
                      theme={theme}
                      label="Apps lock"
                      value={`${d.phoneDownLabel} – 6 AM${hardest?.window ? ` + ${hardest.label.toLowerCase()}` : ""}`}
                    />
                    <PlanLine theme={theme} label="Time back" value={`${d.weeklyHoursSaved} hrs/week`} />
                  </>
                ) : (
                  <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid, marginTop: 8 }}>
                    Slide your goal below what you spend now.
                  </Text>
                )}
              </View>

              <TouchableOpacity
                onPress={apply}
                disabled={saving || d.savedPerDay <= 0}
                activeOpacity={0.85}
                style={[{
                  marginTop: 18, height: 54, borderRadius: 18,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: earn.deep,
                  opacity: (saving || d.savedPerDay <= 0) ? 0.45 : 1,
                }, d.savedPerDay > 0 && theme.fx.glow]}
              >
                {saving
                  ? <ActivityIndicator size="small" color={onDeep} />
                  : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <CheckIcon size={16} color={onDeep} />
                      <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: onDeep }}>
                        {existed ? "Update my plan" : "Start this plan"}
                      </Text>
                    </View>
                  )}
              </TouchableOpacity>
              <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint, marginTop: 10, textAlign: "center" }}>
                Adds these blocked hours. Your own are kept.
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

const kickerStyle = (ink) => ({
  fontFamily: FF.kicker, fontSize: 9, letterSpacing: 2.4,
  color: ink.faint, marginBottom: 10, marginTop: 24,
});

/** Label on the left, the live value on the right — the header of a slider. */
function Field({ theme, label, value, badge }) {
  const { ink, earn } = theme;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
      <Text style={{ fontFamily: FF.kicker, fontSize: 9, letterSpacing: 2.4, color: ink.faint }}>{label}</Text>
      <Text style={{ fontFamily: FF.display, fontSize: 22, color: ink.deep, letterSpacing: -0.3 }}>
        {value}
        {badge ? <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: earn.sage }}>{`  ${badge}`}</Text> : null}
      </Text>
    </View>
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
