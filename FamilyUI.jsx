/**
 * FamilyUI.jsx
 * Small shared pieces for the parent + child shells: a two-tab bottom dock
 * (Home / History) styled like the personal app's tab island, and a History
 * list of completed tasks.
 */
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { getTheme, FF } from "./theme";

const TABS = [
  { id: "home", label: "Home" },
  { id: "history", label: "History" },
];

export function FamilyDock({ tab, onTab, dark = false }) {
  const t = getTheme(dark);
  return (
    <View style={d.wrap} pointerEvents="box-none">
      <View style={[d.dock, { backgroundColor: t.paper.card, borderColor: t.ink.hairline }]}>
        {TABS.map((it) => {
          const active = tab === it.id;
          return (
            <TouchableOpacity
              key={it.id}
              style={[d.item, active && { backgroundColor: t.earn.sageLo }]}
              onPress={() => onTab(it.id)}
              activeOpacity={0.8}
            >
              <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: active ? t.earn.sage : t.ink.mid }}>
                {it.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// items: [{ id, title, minutes, subtitle }]
export function HistoryList({ items, dark = false, emptyText = "No completed tasks yet." }) {
  const t = getTheme(dark);
  if (!items || items.length === 0) {
    return (
      <View style={[d.empty, { borderColor: t.paper.dash }]}>
        <Text style={{ fontFamily: FF.body, fontSize: 14, lineHeight: 21, textAlign: "center", color: t.ink.mid }}>
          {emptyText}
        </Text>
      </View>
    );
  }
  return (
    <View>
      {items.map((x) => (
        <View key={x.id} style={[d.row, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: t.ink.deep }}>{x.title}</Text>
            {x.subtitle ? (
              <Text style={{ fontFamily: FF.body, fontSize: 13, color: t.ink.mid, marginTop: 2 }}>{x.subtitle}</Text>
            ) : null}
          </View>
          <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: t.earn.sage }}>+{x.minutes} min</Text>
        </View>
      ))}
    </View>
  );
}

// Formats an ISO timestamp as e.g. "Jul 14" (or "Today"). Safe on the device.
export function shortDate(iso) {
  if (!iso) return "";
  try {
    const dt = new Date(iso);
    const now = new Date();
    if (dt.toDateString() === now.toDateString()) return "Today";
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

const d = StyleSheet.create({
  wrap: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingBottom: Platform.OS === "ios" ? 28 : 12, paddingTop: 4,
  },
  dock: {
    flexDirection: "row", borderRadius: 24, padding: 6, borderWidth: 1,
    shadowColor: "#1F3A2A", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 18, elevation: 6,
  },
  item: { flex: 1, paddingVertical: 12, borderRadius: 18, alignItems: "center" },
  empty: { borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", padding: 20 },
  row: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
});
