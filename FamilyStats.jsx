/**
 * FamilyStats.jsx
 * The parent's "this week" at a glance: three numbers and a 7-day bar chart,
 * plus the per-kid figures shown on each child row.
 *
 * Everything is derived from data the parent can already read (approved child
 * tasks — see fetchFamilyHistory), so this adds no new queries or permissions.
 *
 * Chart: one series, one hue (sage), thin bars with rounded tops anchored to the
 * baseline, day initials as the only labels. Tap a bar to read that day — the
 * touch equivalent of a hover tooltip — so no bar carries a number by default.
 */
import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { getTheme, FF } from "./theme";

const DAY = 86_400_000;
const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
};
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

/** Consecutive days, ending today (or yesterday), with at least one approved task. */
function streakOf(tasks) {
  const days = new Set(tasks.map((t) => dayKey(t.completed_at)));
  let cursor = startOfDay(Date.now());
  if (!days.has(dayKey(cursor))) cursor -= DAY;   // today not done yet doesn't break it
  let n = 0;
  while (days.has(dayKey(cursor))) { n += 1; cursor -= DAY; }
  return n;
}

/**
 * history: approved tasks [{ user_id, minutes, completed_at }]
 * Returns family totals for the last 7 days, the per-day series, and per-kid stats.
 */
export function useFamilyWeek(history, childIds) {
  return useMemo(() => {
    const today = startOfDay(Date.now());
    const from = today - 6 * DAY;
    const week = history.filter((h) => h.completed_at && new Date(h.completed_at).getTime() >= from);
    const days = Array.from({ length: 7 }, (_, i) => {
      const start = from + i * DAY;
      const items = week.filter((h) => startOfDay(h.completed_at) === start);
      return { start, count: items.length, minutes: items.reduce((a, h) => a + (h.minutes || 0), 0) };
    });
    const perKid = {};
    for (const id of childIds) {
      const mine = history.filter((h) => h.user_id === id);
      const mineWeek = week.filter((h) => h.user_id === id);
      perKid[id] = {
        weekTasks: mineWeek.length,
        weekMinutes: mineWeek.reduce((a, h) => a + (h.minutes || 0), 0),
        streak: streakOf(mine),
      };
    }
    return {
      tasks: week.length,
      minutes: week.reduce((a, h) => a + (h.minutes || 0), 0),
      bestStreak: Math.max(0, ...Object.values(perKid).map((k) => k.streak)),
      days,
      perKid,
    };
  }, [history, childIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function FamilyWeekCard({ week, dark }) {
  const t = getTheme(dark);
  const [sel, setSel] = useState(null);
  const max = Math.max(1, ...week.days.map((d) => d.count));
  const picked = sel != null ? week.days[sel] : null;

  return (
    <View style={[s.card, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
      <Text style={[s.kicker, { color: t.ink.faint }]}>THIS WEEK</Text>

      <View style={s.tiles}>
        <Tile t={t} value={week.tasks} label={week.tasks === 1 ? "task done" : "tasks done"} />
        <View style={[s.rule, { backgroundColor: t.ink.hairline }]} />
        <Tile t={t} value={`${week.minutes}m`} label="earned" />
        <View style={[s.rule, { backgroundColor: t.ink.hairline }]} />
        <Tile t={t} value={`${week.bestStreak}d`} label="best streak" />
      </View>

      {/* Readout for the tapped bar; the day letters sit under the bars. */}
      <Text style={[s.readout, { color: picked ? t.ink.mid : "transparent" }]}>
        {picked
          ? `${new Date(picked.start).toLocaleDateString([], { weekday: "long" })} · ${picked.count} ${picked.count === 1 ? "task" : "tasks"}, ${picked.minutes}m`
          : " "}
      </Text>
      <View style={s.chart}>
        {week.days.map((d, i) => {
          const h = d.count ? Math.max(6, Math.round((d.count / max) * 64)) : 2;
          const on = sel === i;
          const isToday = i === 6;
          return (
            <TouchableOpacity
              key={d.start}
              style={s.col}
              activeOpacity={0.7}
              onPress={() => setSel(on ? null : i)}
              accessibilityLabel={`${new Date(d.start).toLocaleDateString([], { weekday: "long" })}: ${d.count} tasks`}
            >
              <View style={s.barArea}>
                <View style={{
                  width: 14, height: h,
                  borderTopLeftRadius: 4, borderTopRightRadius: 4,
                  backgroundColor: d.count ? t.earn.sage : t.ink.ghost,
                  opacity: sel == null || on ? 1 : 0.45,
                }} />
              </View>
              <Text style={[s.day, { color: isToday ? t.ink.deep : t.ink.faint, fontFamily: isToday ? FF.bodyBold : FF.body }]}>
                {new Date(d.start).toLocaleDateString([], { weekday: "narrow" })}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={[s.baseline, { backgroundColor: t.ink.hairline }]} />
    </View>
  );
}

function Tile({ t, value, label }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={[s.value, { color: t.ink.deep }]}>{value}</Text>
      <Text style={[s.label, { color: t.ink.mid }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 24 },
  kicker: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2, marginBottom: 14 },
  tiles: { flexDirection: "row", alignItems: "center" },
  rule: { width: 1, height: 34 },
  value: { fontFamily: FF.display, fontSize: 26, letterSpacing: -0.3 },
  label: { fontFamily: FF.body, fontSize: 12, marginTop: 2 },
  readout: { fontFamily: FF.bodyMed, fontSize: 12, textAlign: "center", marginTop: 16, marginBottom: 6 },
  chart: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
  col: { flex: 1, alignItems: "center" },
  barArea: { height: 66, justifyContent: "flex-end" },
  day: { fontSize: 11, marginTop: 6 },
  baseline: { height: 1, marginTop: -19, marginBottom: 18, marginHorizontal: 4 },
});
