/**
 * BlockedAppsModal.jsx
 * Modal for picking apps to block during focus / locked tasks.
 * Used during onboarding ("first time") and from the account sheet (anytime).
 */
import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, TextInput, Modal,
  ScrollView, StyleSheet, Alert, Platform,
} from "react-native";
import { getBlockedApps, setBlockedApps, SUGGESTED_APPS } from "./blockedApps";
import { getTheme } from "./theme";

const FO  = "Orbitron_700Bold";
const FOM = "Orbitron_400Regular";
const FK  = "Oswald_700Bold";
const FB  = undefined;

export default function BlockedAppsModal({ visible, onClose, dark = false, firstTime = false }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const [selected, setSelected] = useState({}); // {id: {id, name}}
  const [custom,   setCustom]   = useState("");

  useEffect(() => {
    if (!visible) return;
    getBlockedApps().then(list => {
      const map = {};
      (list || []).forEach(a => { map[a.id] = a; });
      setSelected(map);
    });
  }, [visible]);

  const toggle = (app) => {
    setSelected(prev => {
      const next = { ...prev };
      if (next[app.id]) delete next[app.id];
      else next[app.id] = app;
      return next;
    });
  };

  const addCustom = () => {
    const name = custom.trim();
    if (!name) return;
    const id = "custom_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
    if (selected[id]) { setCustom(""); return; }
    setSelected(prev => ({ ...prev, [id]: { id, name } }));
    setCustom("");
  };

  const save = async () => {
    const list = Object.values(selected);
    await setBlockedApps(list);
    onClose?.();
  };

  const allOptions = [
    ...SUGGESTED_APPS,
    ...Object.values(selected).filter(s => !SUGGESTED_APPS.find(x => x.id === s.id)),
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        {/* Header */}
        <View style={{
          paddingTop: Platform.OS === "ios" ? 54 : 32,
          paddingBottom: 14, paddingHorizontal: 20,
          backgroundColor: paper.card,
          borderBottomWidth: 0.5, borderBottomColor: ink.border,
          flexDirection: "row", alignItems: "center",
        }}>
          {!firstTime && (
            <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
              <Text style={{ fontSize: 22, color: ink.mid, lineHeight: 26 }}>×</Text>
            </TouchableOpacity>
          )}
          <Text style={{ fontFamily: FK, fontSize: 17, color: ink.deep, flex: 1 }}>
            {firstTime ? "Pick apps to block" : "Blocked apps"}
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Explainer */}
          <View style={{
            backgroundColor: earn.blueLo, padding: 14, borderRadius: 12, marginBottom: 18,
            borderWidth: 1, borderColor: "rgba(90,180,212,0.2)",
          }}>
            <Text style={{ fontFamily: FOM, fontSize: 9, color: "#2A7FA0", letterSpacing: 1.5, marginBottom: 6 }}>
              HOW THIS WORKS
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: "#2A7FA0", lineHeight: 18 }}>
              {Platform.OS === "ios"
                ? "Drift will request Screen Time permission and block these apps during your Drift In focus sessions."
                : "Drift will use Digital Wellbeing / accessibility to block these apps during your Drift In focus sessions."}
            </Text>
          </View>

          {/* Suggested + selected */}
          <Text style={{ fontFamily: FOM, fontSize: 9, color: ink.faint, letterSpacing: 2, marginBottom: 10 }}>
            COMMON DISTRACTIONS
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
            {allOptions.map(app => {
              const on = !!selected[app.id];
              return (
                <TouchableOpacity key={app.id} onPress={() => toggle(app)} style={{
                  paddingVertical: 8, paddingHorizontal: 14, borderRadius: 22,
                  borderWidth: 1.5,
                  borderColor: on ? earn.green : ink.border,
                  backgroundColor: on ? earn.greenLo : paper.card,
                  flexDirection: "row", alignItems: "center", gap: 6,
                }}>
                  {on && <Text style={{ color: earn.green, fontSize: 12 }}>✓</Text>}
                  <Text style={{ fontFamily: FB, fontSize: 13, fontWeight: on ? "600" : "400",
                    color: on ? earn.green : ink.deep }}>
                    {app.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Custom add */}
          <Text style={{ fontFamily: FOM, fontSize: 9, color: ink.faint, letterSpacing: 2, marginBottom: 10 }}>
            ADD CUSTOM APP
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 24 }}>
            <TextInput
              value={custom} onChangeText={setCustom}
              placeholder="App name"
              placeholderTextColor={ink.faint}
              returnKeyType="done"
              onSubmitEditing={addCustom}
              style={{
                flex: 1, padding: 11, paddingHorizontal: 14, borderRadius: 10,
                borderWidth: 1, borderColor: ink.border,
                fontFamily: FB, fontSize: 14, color: ink.deep,
                backgroundColor: paper.card,
              }}
            />
            <TouchableOpacity onPress={addCustom} style={{
              paddingHorizontal: 18, borderRadius: 10,
              backgroundColor: earn.terra, alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontFamily: FK, fontSize: 14, color: "#fff" }}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* Save */}
          <TouchableOpacity onPress={save} style={{
            paddingVertical: 14, borderRadius: 14,
            backgroundColor: earn.green, alignItems: "center",
          }}>
            <Text style={{ fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 2 }}>
              {firstTime ? `SAVE & CONTINUE  (${Object.keys(selected).length})` : `SAVE  (${Object.keys(selected).length})`}
            </Text>
          </TouchableOpacity>

          {firstTime && (
            <TouchableOpacity onPress={() => { setSelected({}); save(); }} style={{ paddingVertical: 14, alignItems: "center", marginTop: 6 }}>
              <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid }}>Skip for now</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
