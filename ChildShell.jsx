/**
 * ChildShell.jsx
 * Home screen for a CHILD account. Friendly and lightly gamified. Shows the
 * screen time they have left and the tasks their parent assigned. Marking a task
 * done sends it to the parent for approval; approved tasks grant screen time
 * (applied live via the profile subscription in Drift.jsx).
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Platform, StatusBar, ActivityIndicator,
} from "react-native";
import { getTheme, FF } from "./theme";
import Sprout from "./SproutArt";
import { supabase } from "./supabase";
import { notifyTaskApproved } from "./notifications";
import { fetchChildFamily, fetchChildTasks, submitChildTask } from "./family";

const ACTIVE = ["assigned", "submitted", "rejected"];

export default function ChildShell({ userId, username, secLeft = 0, dark = false, onSignOut }) {
  const t = getTheme(dark);
  const [name, setName] = useState(username || "");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const seenApprovedRef = useRef(null); // approved task ids seen on previous load

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    const list = await fetchChildTasks(userId);
    setTasks(list);
    setLoading(false);
    // Celebrate newly-approved tasks (skip the first load).
    const approved = list.filter((x) => x.status === "approved");
    const prev = seenApprovedRef.current;
    if (prev) {
      approved.filter((x) => !prev.has(x.id)).forEach((x) => notifyTaskApproved(x.minutes));
    }
    seenApprovedRef.current = new Set(approved.map((x) => x.id));
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!userId) return;
      const fam = await fetchChildFamily(userId);
      if (mounted && fam?.display_name) setName(fam.display_name);
      await loadTasks();
    })();
    return () => { mounted = false; };
  }, [userId, loadTasks]);

  // Live: parent assigns / approves → refetch.
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`child_tasks:${userId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` },
        () => { loadTasks(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, loadTasks]);

  async function markDone(task) {
    setBusyId(task.id);
    // Optimistic: flip to submitted locally.
    setTasks((prev) => prev.map((x) => x.id === task.id ? { ...x, status: "submitted" } : x));
    const res = await submitChildTask(task.id, userId);
    if (!res.ok) {
      setTasks((prev) => prev.map((x) => x.id === task.id ? { ...x, status: task.status } : x));
    }
    setBusyId(null);
  }

  const active = tasks.filter((x) => ACTIVE.includes(x.status) && !x.done);
  const mins = Math.max(0, Math.ceil((secLeft || 0) / 60));
  const hasTime = mins > 0;

  return (
    <View style={[c.root, { backgroundColor: t.paper.warm, paddingTop: Platform.OS === "ios" ? 64 : 40 }]}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <Text style={[c.hi, { color: t.ink.deep }]}>Hi{name ? `, ${name}` : ""}! 👋</Text>

        {/* Big time card */}
        <View style={[c.timeCard, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
          <View pointerEvents="none" style={{ position: "absolute", right: -30, bottom: -20, opacity: 0.12 }}>
            <Sprout size={150} tone="fresh" />
          </View>
          <Text style={[c.timeLabel, { color: t.ink.faint }]}>SCREEN TIME LEFT</Text>
          <Text style={[c.timeBig, { color: hasTime ? t.earn.sage : t.ink.faint }]}>{mins}</Text>
          <Text style={[c.timeUnit, { color: t.ink.mid }]}>{mins === 1 ? "minute" : "minutes"}</Text>
        </View>

        <Text style={[c.section, { color: t.ink.faint }]}>YOUR TASKS</Text>

        {loading ? (
          <ActivityIndicator color={t.earn.sage} style={{ marginTop: 20 }} />
        ) : active.length === 0 ? (
          <View style={[c.msgCard, { backgroundColor: t.earn.sageLo }]}>
            <Text style={[c.msgTitle, { color: t.earn.greenD }]}>All caught up! 🌱</Text>
            <Text style={[c.msgBody, { color: t.earn.green }]}>
              No tasks right now. When a parent gives you one, it'll pop up here.
            </Text>
          </View>
        ) : (
          active.map((task) => {
            const submitted = task.status === "submitted";
            const rejected = task.status === "rejected";
            return (
              <View key={task.id} style={[c.taskCard, { backgroundColor: t.paper.card, borderColor: submitted ? t.earn.sage : t.ink.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[c.taskTitle, { color: t.ink.deep }]}>{task.title}</Text>
                  <Text style={[c.taskReward, { color: t.earn.sage }]}>
                    +{task.minutes} min{rejected ? " · sent back, try again" : ""}
                  </Text>
                </View>
                {submitted ? (
                  <View style={[c.waitPill, { backgroundColor: t.earn.sageLo }]}>
                    <Text style={[c.waitText, { color: t.earn.greenD }]}>Waiting ⏳</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[c.doneBtn, { backgroundColor: t.earn.deep }]}
                    onPress={() => markDone(task)}
                    disabled={busyId === task.id}
                  >
                    {busyId === task.id
                      ? <ActivityIndicator color="#FAF6EE" />
                      : <Text style={[c.doneText, { color: "#FAF6EE" }]}>Done</Text>}
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}

        <TouchableOpacity style={c.signOut} onPress={onSignOut}>
          <Text style={[c.signOutText, { color: t.ink.faint }]}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const c = StyleSheet.create({
  root: { flex: 1 },
  hi: { fontFamily: FF.display, fontSize: 32, letterSpacing: -0.3, marginBottom: 20, marginTop: 8 },
  timeCard: { borderRadius: 24, borderWidth: 1, paddingVertical: 30, alignItems: "center", marginBottom: 24, overflow: "hidden" },
  timeLabel: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2, marginBottom: 10 },
  timeBig: { fontFamily: FF.display, fontSize: 72, lineHeight: 78 },
  timeUnit: { fontFamily: FF.bodyMed, fontSize: 16, marginTop: 2 },
  section: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2, marginBottom: 12 },
  msgCard: { borderRadius: 18, padding: 20 },
  msgTitle: { fontFamily: FF.bodyBold, fontSize: 17, marginBottom: 6 },
  msgBody: { fontFamily: FF.body, fontSize: 14, lineHeight: 21 },
  taskCard: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 10 },
  taskTitle: { fontFamily: FF.bodyMed, fontSize: 16 },
  taskReward: { fontFamily: FF.bodyMed, fontSize: 13, marginTop: 3 },
  doneBtn: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 22, minWidth: 74, alignItems: "center" },
  doneText: { fontFamily: FF.bodyMed, fontSize: 15 },
  waitPill: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14 },
  waitText: { fontFamily: FF.bodyMed, fontSize: 13 },
  signOut: { marginTop: 28, alignItems: "center", paddingVertical: 12 },
  signOutText: { fontFamily: FF.bodyMed, fontSize: 13 },
});
