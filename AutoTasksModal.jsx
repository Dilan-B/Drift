/**
 * AutoTasksModal.jsx
 * Settings for the two "tasks suggest themselves" features:
 *   - Places: save a spot (gym, office, library); arriving there offers a task.
 *   - Calendar: pull today's events in as tasks.
 *
 * Both are OFF by default and fully optional — Drift works exactly as before
 * if you never open this screen. Location is never uploaded anywhere; the
 * calendar is read-only.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, ScrollView, Switch, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { FF, getTheme } from "./theme";
import { CloseIcon, CheckIcon } from "./Icons";
import { LeafGlyph } from "./SproutArt";
import {
  getPlaces, addPlace, removePlace, getCurrentCoords, setSuggestionsEnabled,
  isSuggestionsEnabled, PLACE_PRESETS, MAX_PLACES,
} from "./places";
import {
  calendarAvailable, isCalendarSyncEnabled, setCalendarSyncEnabled,
  listCalendars, getSelectedCalendarIds, setSelectedCalendarIds,
  requestCalendarPermission, applyDefaultCalendarSelection,
} from "./calendarSync";

export default function AutoTasksModal({ visible, dark = false, onClose, onImportCalendar }) {
  const theme = getTheme(dark);
  const { ink, paper, earn, fx } = theme;
  const onDeep = dark ? "#16261C" : "#FAF6EE";

  const [placesOn, setPlacesOn]   = useState(false);
  const [places, setPlaces]       = useState([]);
  const [savingPlace, setSaving]  = useState(false);
  const [newLabel, setNewLabel]   = useState("");
  const [preset, setPreset]       = useState(PLACE_PRESETS[0]);

  const [calOn, setCalOn]         = useState(false);
  const [calendars, setCalendars] = useState([]);
  const [calIds, setCalIds]       = useState([]);
  const [calLoading, setCalLoading] = useState(false);

  const refresh = useCallback(async () => {
    setPlacesOn(await isSuggestionsEnabled());
    setPlaces(await getPlaces());
    setCalOn(await isCalendarSyncEnabled());
    setCalIds(await getSelectedCalendarIds());
  }, []);

  useEffect(() => { if (visible) refresh(); }, [visible, refresh]);

  // ── Places ──
  const togglePlaces = async (on) => {
    setPlacesOn(on); // optimistic
    const res = await setSuggestionsEnabled(on);
    if (on && !res.granted) {
      setPlacesOn(false);
      Alert.alert(
        res.reason === "foreground_only" ? "Always-on location needed" : "Location needed",
        res.reason === "foreground_only"
          ? "Drift needs \"Always\" location access to notice when you arrive somewhere. You can change this in Settings → Drift → Location."
          : res.reason === "unavailable"
            ? "Location isn't available in this build."
            : "Enable location access for Drift to use place suggestions.",
      );
    }
  };

  const savePlaceHere = async () => {
    setSaving(true);
    try {
      const coords = await getCurrentCoords();
      if (!coords) {
        Alert.alert("Couldn't get location", "Make sure location access is on, then try again.");
        return;
      }
      const res = await addPlace({
        label: newLabel.trim() || preset.label,
        title: preset.title,
        cat: preset.cat,
        minutes: preset.minutes,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      if (!res.ok && res.reason === "limit") {
        Alert.alert("Place limit reached", `You can save up to ${MAX_PLACES} places.`);
        return;
      }
      setNewLabel("");
      setPlaces(await getPlaces());
    } finally {
      setSaving(false);
    }
  };

  const deletePlace = (p) => {
    Alert.alert(`Remove ${p.label}?`, "You'll stop getting task suggestions there.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => { await removePlace(p.id); setPlaces(await getPlaces()); },
      },
    ]);
  };

  // ── Calendar ──
  const toggleCalendar = async (on) => {
    setCalOn(on);
    await setCalendarSyncEnabled(on);
    if (!on) return;
    setCalLoading(true);
    try {
      const ok = await requestCalendarPermission();
      if (!ok) {
        setCalOn(false);
        await setCalendarSyncEnabled(false);
        Alert.alert("Calendar access needed", "Allow calendar access to import events as tasks.");
        return;
      }
      setCalendars(await listCalendars());
      // Preselect Google calendars (falling back to the device's own) so the
      // common case needs zero taps.
      setCalIds(await applyDefaultCalendarSelection());
    } finally {
      setCalLoading(false);
    }
  };

  useEffect(() => {
    if (visible && calOn && calendars.length === 0) {
      (async () => {
        setCalLoading(true);
        try { setCalendars(await listCalendars()); } finally { setCalLoading(false); }
      })();
    }
  }, [visible, calOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCalendarId = async (id) => {
    const next = calIds.includes(id) ? calIds.filter(x => x !== id) : [...calIds, id];
    setCalIds(next);
    await setSelectedCalendarIds(next);
  };

  const kicker = { fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 2.4, marginBottom: 10 };
  const card = {
    backgroundColor: paper.card, borderRadius: 24,
    borderWidth: 1, borderColor: ink.border, padding: 18, marginBottom: 14,
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        {/* Aurora */}
        <View pointerEvents="none" style={{
          position: "absolute", top: -120, right: -90,
          width: 300, height: 300, borderRadius: 150, backgroundColor: fx.auroraMint,
        }} />
        <View pointerEvents="none" style={{
          position: "absolute", bottom: -130, left: -100,
          width: 280, height: 280, borderRadius: 140, backgroundColor: fx.auroraClay,
        }} />

        {/* Header */}
        <View style={{
          flexDirection: "row", alignItems: "flex-start",
          paddingTop: Platform.OS === "ios" ? 62 : 34,
          paddingHorizontal: 22, marginBottom: 18,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={kicker}>AUTOMATIC TASKS</Text>
            <Text style={{ fontFamily: FF.display, fontSize: 34, color: ink.deep, letterSpacing: -0.4 }}>
              Suggestions
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{
              width: 36, height: 36, borderRadius: 18, marginTop: 6,
              alignItems: "center", justifyContent: "center", backgroundColor: ink.ghost,
            }}
          >
            <CloseIcon size={14} color={ink.mid} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Places ── */}
          <View style={card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep }}>
                  Place suggestions
                </Text>
                <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 3, lineHeight: 17 }}>
                  Arrive somewhere you've saved and Drift offers the task.
                </Text>
              </View>
              <Switch
                value={placesOn}
                onValueChange={togglePlaces}
                trackColor={{ false: ink.ghost, true: earn.sage }}
                thumbColor={Platform.OS === "android" ? (placesOn ? earn.deep : "#f4f3f4") : undefined}
              />
            </View>

            {placesOn && (
              <>
                <View style={{ height: 1, backgroundColor: ink.hairline, marginVertical: 18 }} />

                <Text style={kicker}>SAVED PLACES</Text>
                {places.length === 0 ? (
                  <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint, lineHeight: 18, marginBottom: 14 }}>
                    None yet. Stand at a place you go often — your gym, the
                    library — and save it below.
                  </Text>
                ) : (
                  <View style={{ gap: 8, marginBottom: 14 }}>
                    {places.map(p => (
                      <View key={p.id} style={{
                        flexDirection: "row", alignItems: "center", gap: 12,
                        backgroundColor: paper.sand, borderRadius: 16, padding: 14,
                      }}>
                        <LeafGlyph size={15} color={earn.sage} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ fontFamily: FF.bodyMed, fontSize: 14, color: ink.deep }}>
                            {p.label}
                          </Text>
                          <Text numberOfLines={1} style={{ fontFamily: FF.body, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                            {p.title} · {p.minutes}m
                          </Text>
                        </View>
                        <TouchableOpacity onPress={() => deletePlace(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={{ fontFamily: FF.body, fontSize: 12, color: theme.danger.fg }}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                <Text style={kicker}>SAVE WHERE YOU ARE</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {PLACE_PRESETS.map(ps => {
                    const active = preset.label === ps.label;
                    return (
                      <TouchableOpacity
                        key={ps.label}
                        onPress={() => setPreset(ps)}
                        activeOpacity={0.8}
                        style={{
                          paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999,
                          borderWidth: 1.2,
                          borderColor: active ? earn.sage : ink.border,
                          backgroundColor: active ? earn.sageLo : "transparent",
                        }}
                      >
                        <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: active ? earn.sage : ink.mid }}>
                          {ps.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  value={newLabel}
                  onChangeText={setNewLabel}
                  placeholder={`Name (default "${preset.label}")`}
                  placeholderTextColor={ink.faint}
                  maxLength={40}
                  style={{
                    backgroundColor: paper.sand, borderRadius: 16,
                    paddingHorizontal: 16, paddingVertical: 13,
                    fontFamily: FF.bodyMed, fontSize: 14, color: ink.deep,
                  }}
                />
                <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.faint, marginTop: 8, lineHeight: 16 }}>
                  Suggests "{preset.title}" ({preset.minutes}m) when you arrive.
                </Text>
                <TouchableOpacity
                  onPress={savePlaceHere}
                  disabled={savingPlace}
                  activeOpacity={0.85}
                  style={[{
                    height: 48, borderRadius: 16, marginTop: 12,
                    alignItems: "center", justifyContent: "center",
                    flexDirection: "row", gap: 8,
                    backgroundColor: earn.deep, opacity: savingPlace ? 0.7 : 1,
                  }, fx.glow]}
                >
                  {savingPlace
                    ? <ActivityIndicator size="small" color={onDeep} />
                    : <CheckIcon size={15} color={onDeep} />}
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: onDeep }}>
                    {savingPlace ? "Saving…" : "Save this place"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* ── Calendar ── */}
          {calendarAvailable() && (
            <View style={card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep }}>
                    Calendar sync
                  </Text>
                  <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 3, lineHeight: 17 }}>
                    Bring today's events in as tasks. Read-only — Drift never
                    changes your calendar.
                  </Text>
                </View>
                <Switch
                  value={calOn}
                  onValueChange={toggleCalendar}
                  trackColor={{ false: ink.ghost, true: earn.sage }}
                  thumbColor={Platform.OS === "android" ? (calOn ? earn.deep : "#f4f3f4") : undefined}
                />
              </View>

              {calOn && (
                <>
                  <View style={{ height: 1, backgroundColor: ink.hairline, marginVertical: 18 }} />
                  <Text style={kicker}>CALENDARS TO USE</Text>
                  {calLoading ? (
                    <ActivityIndicator color={earn.sage} style={{ marginVertical: 12 }} />
                  ) : calendars.length === 0 ? (
                    <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint, lineHeight: 18 }}>
                      No calendars found. If you use Google Calendar, add your
                      Google account in Settings → Calendar → Accounts, then
                      come back.
                    </Text>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {calendars.map(c => {
                        const on = calIds.includes(c.id);
                        return (
                          <TouchableOpacity
                            key={c.id}
                            onPress={() => toggleCalendarId(c.id)}
                            activeOpacity={0.8}
                            style={{
                              flexDirection: "row", alignItems: "center", gap: 12,
                              backgroundColor: paper.sand, borderRadius: 16, padding: 14,
                              borderWidth: 1.2, borderColor: on ? earn.sage : "transparent",
                            }}
                          >
                            <View style={{
                              width: 10, height: 10, borderRadius: 5,
                              backgroundColor: c.color || earn.sage,
                            }} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text numberOfLines={1} style={{ fontFamily: FF.bodyMed, fontSize: 14, color: ink.deep, flexShrink: 1 }}>
                                  {c.title}
                                </Text>
                                {c.isGoogle && (
                                  <View style={{
                                    paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999,
                                    backgroundColor: earn.sageLo,
                                  }}>
                                    <Text style={{ fontFamily: FF.kicker, fontSize: 7, color: earn.sage, letterSpacing: 1 }}>
                                      GOOGLE
                                    </Text>
                                  </View>
                                )}
                              </View>
                              {!!c.source && (
                                <Text numberOfLines={1} style={{ fontFamily: FF.body, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                                  {c.source}
                                </Text>
                              )}
                            </View>
                            {on && <CheckIcon size={16} color={earn.sage} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <TouchableOpacity
                    onPress={() => { onClose?.(); onImportCalendar?.(); }}
                    disabled={calIds.length === 0}
                    activeOpacity={0.85}
                    style={[{
                      height: 48, borderRadius: 16, marginTop: 14,
                      alignItems: "center", justifyContent: "center",
                      backgroundColor: calIds.length ? earn.deep : ink.ghost,
                    }, calIds.length > 0 && fx.glow]}
                  >
                    <Text style={{
                      fontFamily: FF.bodyMed, fontSize: 14,
                      color: calIds.length ? onDeep : ink.faint,
                    }}>
                      Import today's events
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          <Text style={{
            fontFamily: FF.body, fontSize: 11, color: ink.faint,
            lineHeight: 17, textAlign: "center", paddingHorizontal: 8,
          }}>
            Your location and calendar stay on this device. Drift never uploads
            either one.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}
