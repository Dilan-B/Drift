/**
 * LanguagePicker.jsx
 * "Language" row + full-screen list. Each language is shown in its own script
 * (someone who can't read English must still be able to find theirs), with the
 * English name underneath. "Use device language" clears the explicit choice.
 *
 * Picking one saves it and reloads the JS bundle (see i18n/index.js), so the
 * whole app comes back in the new language.
 */
import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, TextInput, Platform } from "react-native";
import { getTheme, FF } from "./theme";
import { tr, LANGUAGES, getLanguage, getPinnedLanguage, setLanguage } from "./i18n";

export function languageName(code) {
  return LANGUAGES.find((l) => l.code === code)?.native || "English";
}

export default function LanguagePicker({ dark = false, rowStyle, textStyle, chevronStyle }) {
  const t = getTheme(dark);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pinned = getPinnedLanguage();
  const current = getLanguage();

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? LANGUAGES.filter((l) => l.native.toLowerCase().includes(q) || l.name.toLowerCase().includes(q) || l.code.toLowerCase().startsWith(q))
      : LANGUAGES;
    return [{ code: null, native: tr("Use device language"), name: "" }, ...list];
  }, [query]);

  async function choose(code) {
    setOpen(false);
    setQuery("");
    if (code === pinned) return;
    await setLanguage(code);
  }

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={rowStyle} accessibilityRole="button">
        <Text style={textStyle}>{tr("Language")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[textStyle, { color: t.ink.faint, marginRight: 6 }]} numberOfLines={1}>
            {languageName(current)}
          </Text>
          <Text style={chevronStyle}>›</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[s.sheet, { backgroundColor: t.paper.warm }]}>
          <View style={s.header}>
            <Text style={[s.title, { color: t.ink.deep }]}>{tr("Language")}</Text>
            <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={[s.done, { color: t.earn.sage }]}>{tr("Done")}</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tr("Search languages")}
            placeholderTextColor={t.ink.faint}
            autoCorrect={false}
            style={[s.search, { color: t.ink.deep, backgroundColor: t.paper.card, borderColor: t.ink.border }]}
          />
          <FlatList
            data={items}
            keyExtractor={(l) => l.code || "device"}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const selected = item.code === pinned;
              return (
                <TouchableOpacity onPress={() => choose(item.code)} style={[s.item, { borderColor: t.ink.hairline }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.native, { color: t.ink.deep }]}>{item.native}</Text>
                    {item.name ? <Text style={[s.english, { color: t.ink.faint }]}>{item.name}</Text> : null}
                  </View>
                  {selected ? <Text style={[s.check, { color: t.earn.sage }]}>✓</Text> : null}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  sheet: { flex: 1, paddingTop: Platform.OS === "ios" ? 18 : 30 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 12 },
  title: { fontFamily: FF.display, fontSize: 26 },
  done: { fontFamily: FF.bodyMed, fontSize: 16 },
  search: { marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontFamily: FF.body, fontSize: 16 },
  item: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  native: { fontSize: 17 },
  english: { fontFamily: FF.body, fontSize: 13, marginTop: 2 },
  check: { fontSize: 18, fontFamily: FF.bodyBold },
});
