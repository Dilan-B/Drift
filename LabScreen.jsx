/**
 * LabScreen.jsx
 * "The Lab" — the tinkering surface.
 *
 * Everything here changes how Drift behaves rather than who you are: what gets
 * blocked, what repeats, what gets suggested. These rows used to be buried in
 * the profile sheet next to sign-out and billing, where nobody found them.
 * Account settings stay in Profile; behaviour lives here.
 *
 * The switches you actually flip are ON this screen — a settings page whose
 * every row is a door to another screen makes you open four things to learn
 * the state of four things. Anything that needs a list or a picker (choosing
 * calendars, managing places, editing recurring tasks) still opens its own
 * modal, which stays the single source of truth for that feature.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Switch, Platform } from "react-native";
import { FF, getTheme } from "./theme";
import { LeafGlyph } from "./SproutArt";
import { PhoneIcon, LockIcon, ClipboardIcon, SparkleIcon } from "./Icons";
import { getBlockedSelectionCount } from "./blockedApps";
import {
  calendarAvailable, isCalendarSyncEnabled, setCalendarSyncEnabled,
  isCalendarAutoImportEnabled, setCalendarAutoImportEnabled,
  requestCalendarPermission, applyDefaultCalendarSelection,
} from "./calendarSync";
import { isSuggestionsEnabled, setSuggestionsEnabled } from "./places";

/** A labelled switch. The unit this screen is mostly built from. */
function ToggleRow({ title, sub, value, onValueChange, theme, dark, last }) {
  const { ink, earn } = theme;
  return (
    <View style={{
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingVertical: 15,
      borderBottomWidth: last ? 0 : 1,
      borderBottomColor: ink.hairline,
    }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep }}>{title}</Text>
        <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 3, lineHeight: 17 }}>
          {sub}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: ink.ghost, true: earn.sage }}
        thumbColor={Platform.OS === "android" ? (value ? earn.deep : "#f4f3f4") : undefined}
      />
    </View>
  );
}

/** A row that opens something — used only where a list or picker is required. */
function LinkRow({ Icon, title, sub, onPress, theme, last, badge }) {
  const { ink, earn } = theme;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        flexDirection: "row", alignItems: "center", gap: 14,
        paddingVertical: 15,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: ink.hairline,
      }}
    >
      {Icon && (
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          alignItems: "center", justifyContent: "center",
          backgroundColor: earn.sageLo,
        }}>
          <Icon size={16} color={earn.sage} strokeWidth={1.8} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep }}>{title}</Text>
        <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 3, lineHeight: 17 }}>
          {sub}
        </Text>
      </View>
      {!!badge && (
        <Text style={{ fontFamily: FF.bodyMed, fontSize: 12, color: earn.sage }}>{badge}</Text>
      )}
      <Text style={{ fontFamily: FF.body, fontSize: 18, color: ink.faint }}>›</Text>
    </TouchableOpacity>
  );
}

export default function LabScreen({
  dark = false,
  visible = true,
  onOpenAutoTasks,
  onOpenBlockedApps,
  onOpenBlockedHours,
  onOpenRecurringTasks,
  onReplayTour,
}) {
  const theme = getTheme(dark);
  const { ink, paper, earn, fx } = theme;
  const onDeep = dark ? "#16261C" : "#FAF6EE";

  const [blockedCount, setBlockedCount] = useState(0);
  const [calOn, setCalOn]     = useState(false);
  const [calAuto, setCalAuto] = useState(true);
  const [placesOn, setPlacesOn] = useState(false);

  const refresh = useCallback(async () => {
    setBlockedCount(await getBlockedSelectionCount());
    setCalOn(await isCalendarSyncEnabled());
    setCalAuto(await isCalendarAutoImportEnabled());
    setPlacesOn(await isSuggestionsEnabled());
  }, []);

  // Re-read whenever the tab is shown: the modals this screen links out to can
  // change any of these behind our back.
  useEffect(() => { if (visible) refresh(); }, [visible, refresh]);

  // Turning calendar sync on here does the same permission + default-selection
  // dance the full modal does, so the toggle is genuinely usable on its own.
  const toggleCalendar = async (on) => {
    setCalOn(on);
    await setCalendarSyncEnabled(on);
    if (!on) return;
    const ok = await requestCalendarPermission();
    if (!ok) {
      setCalOn(false);
      await setCalendarSyncEnabled(false);
      return;
    }
    await applyDefaultCalendarSelection();
  };

  const togglePlaces = async (on) => {
    setPlacesOn(on);
    const res = await setSuggestionsEnabled(on);
    if (on && !res?.granted) setPlacesOn(false);
  };

  const toggleAutoImport = async (on) => {
    setCalAuto(on);
    await setCalendarAutoImportEnabled(on);
  };

  const kicker = {
    fontFamily: FF.kicker, fontSize: 9, color: ink.faint,
    letterSpacing: 2.4, marginBottom: 10,
  };
  const card = {
    backgroundColor: paper.card, borderRadius: 24,
    borderWidth: 1, borderColor: ink.border,
    paddingHorizontal: 18, paddingVertical: 4,
    marginBottom: 16,
  };

  return (
    <View style={{ flex: 1, backgroundColor: paper.warm }}>
      <View pointerEvents="none" style={{
        position: "absolute", top: -120, right: -90,
        width: 300, height: 300, borderRadius: 150, backgroundColor: fx.auroraMint,
      }} />
      <View pointerEvents="none" style={{
        position: "absolute", bottom: -130, left: -100,
        width: 280, height: 280, borderRadius: 140, backgroundColor: fx.auroraClay,
      }} />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingTop: Platform.OS === "ios" ? 58 : 30,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={kicker}>TINKER</Text>
        <Text style={{
          fontFamily: FF.display, fontSize: 34, color: ink.deep,
          letterSpacing: -0.4, marginBottom: 6,
        }}>
          The Lab
        </Text>
        <Text style={{
          fontFamily: FF.body, fontSize: 13, color: ink.mid,
          lineHeight: 19, marginBottom: 24,
        }}>
          Everything that changes how Drift behaves.
        </Text>

        {/* ── Blocking ── */}
        <Text style={kicker}>WHAT GETS BLOCKED</Text>
        <View style={[card, { paddingVertical: 18 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep }}>
                Blocked apps
              </Text>
              <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 3, lineHeight: 17 }}>
                {blockedCount > 0
                  ? `${blockedCount} ${blockedCount === 1 ? "selection" : "selections"} — locked when your balance hits zero.`
                  : "Nothing selected yet — the shield has nothing to lock."}
              </Text>
            </View>
            <View style={{
              paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999,
              backgroundColor: blockedCount > 0 ? earn.sageLo : ink.ghost,
            }}>
              <Text style={{
                fontFamily: FF.kicker, fontSize: 11,
                color: blockedCount > 0 ? earn.sage : ink.faint,
              }}>
                {blockedCount}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={async () => { await onOpenBlockedApps?.(); refresh(); }}
            activeOpacity={0.85}
            style={{
              height: 44, borderRadius: 14,
              alignItems: "center", justifyContent: "center",
              backgroundColor: earn.deep, marginBottom: 4,
            }}
          >
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: onDeep }}>
              {blockedCount > 0 ? "Change blocked apps" : "Choose apps to block"}
            </Text>
          </TouchableOpacity>

          <View style={{ height: 1, backgroundColor: ink.hairline, marginVertical: 14 }} />

          <LinkRow
            theme={theme}
            Icon={LockIcon}
            title="Blocked hours"
            sub="Windows where apps stay locked no matter your balance."
            onPress={onOpenBlockedHours}
            last
          />
        </View>

        {/* ── Suggestions ── */}
        <Text style={kicker}>WHAT SHOWS UP</Text>
        <View style={card}>
          {calendarAvailable() && (
            <>
              <ToggleRow
                theme={theme}
                dark={dark}
                title="Calendar sync"
                sub="Turn today's events into tasks. Read-only."
                value={calOn}
                onValueChange={toggleCalendar}
              />
              {calOn && (
                <ToggleRow
                  theme={theme}
                  dark={dark}
                  title="Import automatically"
                  sub="Pull today's events in once a day on their own."
                  value={calAuto}
                  onValueChange={toggleAutoImport}
                />
              )}
            </>
          )}
          <ToggleRow
            theme={theme}
            dark={dark}
            title="Place suggestions"
            sub="Offer a task when you arrive somewhere you've saved."
            value={placesOn}
            onValueChange={togglePlaces}
          />
          <LinkRow
            theme={theme}
            title="Calendars & places"
            sub="Choose which calendars to read and manage saved places."
            onPress={async () => { await onOpenAutoTasks?.(); refresh(); }}
            last
          />
        </View>

        {/* ── Tasks ── */}
        <Text style={kicker}>TASKS</Text>
        <View style={card}>
          <LinkRow
            theme={theme}
            Icon={ClipboardIcon}
            title="Recurring tasks"
            sub="Tasks that come back on a schedule."
            onPress={onOpenRecurringTasks}
            last
          />
        </View>

        {/* ── Learn ── */}
        <Text style={kicker}>LEARN THE APP</Text>
        <View style={card}>
          <LinkRow
            theme={theme}
            Icon={SparkleIcon}
            title="Replay the tour"
            sub="The guided walkthrough from your first launch."
            onPress={onReplayTour}
            last
          />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 8 }}>
          <LeafGlyph size={12} color={earn.sage} />
          <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.faint }}>
            Account settings live in your profile.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
