/**
 * SuggestedTaskModal.jsx
 * "You're at the gym — add this task?" confirm sheet.
 *
 * Opened when the user taps a location-arrival notification (or a calendar
 * import row). The suggestion is a STARTING POINT, never a commitment: title,
 * category and length are all editable before confirming, and dismissing adds
 * nothing.
 */
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { FF, getTheme } from "./theme";
import { LeafGlyph } from "./SproutArt";

const CATS = {
  work:     { c: "#3A7AB8", l: "Work" },
  physical: { c: "#2FAB72", l: "Physical" },
  outdoor:  { c: "#3DA870", l: "Outdoor" },
  learning: { c: "#7B6EC8", l: "Learning" },
  life:     { c: "#5AB4D4", l: "Life" },
  social:   { c: "#3A9BB5", l: "Social" },
};

const LENGTHS = [15, 30, 45, 60, 90];

export default function SuggestedTaskModal({ suggestion, dark = false, onConfirm, onDismiss }) {
  const theme = getTheme(dark);
  const { ink, paper, earn, fx } = theme;
  const onDeep = dark ? "#16261C" : "#FAF6EE";

  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("life");
  const [minutes, setMinutes] = useState(30);

  // Re-seed whenever a new suggestion arrives.
  useEffect(() => {
    if (!suggestion) return;
    setTitle(suggestion.title || "");
    setCat(suggestion.cat && CATS[suggestion.cat] ? suggestion.cat : "life");
    setMinutes(Math.max(5, Math.min(300, Number(suggestion.minutes) || 30)));
  }, [suggestion]);

  if (!suggestion) return null;

  const ready = !!title.trim();
  const kicker = suggestion.source === "calendar"
    ? "FROM YOUR CALENDAR"
    : suggestion.label ? `YOU'RE AT ${String(suggestion.label).toUpperCase()}` : "SUGGESTED TASK";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,26,17,0.45)" }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{
            backgroundColor: paper.warm,
            borderTopLeftRadius: 30, borderTopRightRadius: 30,
            borderWidth: 1, borderColor: ink.border,
            overflow: "hidden",
            paddingBottom: Platform.OS === "ios" ? 30 : 16,
          }}>
            {/* Aurora */}
            <View pointerEvents="none" style={{
              position: "absolute", top: -110, right: -80,
              width: 260, height: 260, borderRadius: 130,
              backgroundColor: fx.auroraMint,
            }} />

            <View style={{ paddingHorizontal: 22, paddingTop: 18 }}>
              <View style={{
                width: 38, height: 4, borderRadius: 2, alignSelf: "center",
                backgroundColor: ink.border, marginBottom: 16,
              }} />

              <Text style={{
                fontFamily: FF.kicker, fontSize: 9, color: ink.faint,
                letterSpacing: 2.4, marginBottom: 6,
              }}>
                {kicker}
              </Text>
              <Text style={{ fontFamily: FF.display, fontSize: 30, color: ink.deep, letterSpacing: -0.4 }}>
                Add this task?
              </Text>
              <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, marginTop: 6, lineHeight: 19 }}>
                Change anything you like before confirming.
              </Text>
            </View>

            <ScrollView
              style={{ maxHeight: 380 }}
              contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 16 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={{
                backgroundColor: paper.card,
                borderRadius: 24, borderWidth: 1, borderColor: ink.border,
                padding: 18,
              }}>
                <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 2.4, marginBottom: 10 }}>
                  TASK
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="What will you do?"
                  placeholderTextColor={ink.faint}
                  maxLength={80}
                  style={{
                    backgroundColor: paper.sand,
                    borderWidth: 1.2,
                    borderColor: ready ? earn.sage : "transparent",
                    borderRadius: 16,
                    paddingHorizontal: 16, paddingVertical: 14,
                    fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep,
                  }}
                />

                <View style={{ height: 1, backgroundColor: ink.hairline, marginVertical: 18 }} />

                <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 2.4, marginBottom: 10 }}>
                  CATEGORY
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {Object.entries(CATS).map(([k, v]) => {
                    const active = cat === k;
                    return (
                      <TouchableOpacity
                        key={k}
                        onPress={() => setCat(k)}
                        activeOpacity={0.8}
                        style={{
                          paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999,
                          borderWidth: 1.2,
                          borderColor: active ? v.c : ink.border,
                          backgroundColor: active ? `${v.c}18` : "transparent",
                        }}
                      >
                        <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: active ? v.c : ink.mid }}>
                          {v.l}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={{ height: 1, backgroundColor: ink.hairline, marginVertical: 18 }} />

                <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 2.4, marginBottom: 10 }}>
                  LENGTH
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {LENGTHS.map(m => {
                    const active = minutes === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setMinutes(m)}
                        activeOpacity={0.8}
                        style={{
                          paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999,
                          borderWidth: 1.2,
                          borderColor: active ? earn.sage : ink.border,
                          backgroundColor: active ? earn.sageLo : "transparent",
                        }}
                      >
                        <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: active ? earn.sage : ink.mid }}>
                          {m >= 60 ? `${m / 60}h`.replace(".5h", "½h") : `${m}m`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </ScrollView>

            <View style={{ paddingHorizontal: 22, paddingTop: 14 }}>
              <TouchableOpacity
                onPress={() => ready && onConfirm?.({ title: title.trim(), cat, minutes })}
                disabled={!ready}
                activeOpacity={0.85}
                style={[
                  {
                    height: 54, borderRadius: 18,
                    alignItems: "center", justifyContent: "center",
                    flexDirection: "row", gap: 9,
                    backgroundColor: ready ? earn.deep : ink.ghost,
                  },
                  ready && fx.glow,
                ]}
              >
                {ready && <LeafGlyph size={15} color={onDeep} />}
                <Text style={{
                  fontFamily: FF.bodyMed, fontSize: 15, letterSpacing: 0.2,
                  color: ready ? onDeep : ink.faint,
                }}>
                  Add task
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onDismiss} style={{ height: 44, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid }}>
                  Not now
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
