/**
 * SocialScreen.jsx
 * Friends, pending requests, and live challenges.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, LayoutAnimation, Modal, Platform, RefreshControl, Share,
  Pressable, StyleSheet, Text, TextInput, TouchableOpacity, UIManager, View, Vibration,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Circle as SvgCircle, Ellipse, Defs, RadialGradient, Stop } from "react-native-svg";
import AICheckModal from "./AICheckModal";
import { supabase, getFriendsWithScreenTime } from "./supabase";
import { CloseIcon, LockIcon, ShareIcon, UsersIcon } from "./Icons";
import ChallengeSheet from "./ChallengeModal";
import Swipeable from "./Swipeable";
import { cached, invalidateCache, rateLimited } from "./apiGuards";
import { FF } from "./theme";
import Sprout, { LeafGlyph, Sprig } from "./SproutArt";

let Clipboard = null;
try { Clipboard = require("expo-clipboard"); } catch { Clipboard = null; }

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const terra = "#2D7A52";
// Upright, lighter Playfair Display - same family, no slant, slimmer strokes
const FD = "PlayfairDisplay_500Medium";
const FB = "DMSans_400Regular";
const FO = "Orbitron_700Bold";
const FK = "Oswald_700Bold";

const palette = (dark) => dark ? {
  bg: "#0F1611",
  card: "#171F18",
  card2: "#1A2320",
  ink: "#E8EEDF",
  mid: "#9DAE9A",
  faint: "#566357",
  border: "rgba(255,255,255,0.08)",
  hairline: "rgba(255,255,255,0.06)",
  wash: "rgba(127,190,150,0.13)",
  washStrong: "rgba(127,190,150,0.22)",
  input: "#171F18",
  sage:    "#A8C99A",
  sageInk: "#A8C99A",
  deep:    "#D8E8C5",
  clay:    "#CCA07E",
  clayLo:  "rgba(204,160,126,0.14)",
} : {
  bg: "#F7F7F4",
  card: "#FFFFFF",
  card2: "#FBFBF9",
  ink: "#1A2820",
  mid: "#6B7A6E",
  faint: "#A8B0A8",
  border: "rgba(26,40,32,0.08)",
  hairline: "rgba(26,40,32,0.06)",
  wash: "#E4ECE0",
  washStrong: "rgba(62,107,78,0.14)",
  input: "#FAF6EE",
  sage:    "#3E6B4E",
  sageInk: "#3E6B4E",
  deep:    "#1F3A2A",
  clay:    "#B0764E",
  clayLo:  "#EEE0CF",
};

/**
 * GrowthState - translates a friend's screen-time today into a "plant health"
 * stage. Less screen time = thriving (vibrant, upright). More = wilting.
 * This is the engine that turns numbers into emotion.
 */
function growthState(minutes) {
  // <30m = thriving, 30-90 = good, 90-180 = ok, 180+ = wilting
  if (minutes < 30)  return { stage: 4, label: "Thriving",  hue: "#5C9670" };
  if (minutes < 90)  return { stage: 3, label: "Growing",   hue: "#7FB58A" };
  if (minutes < 180) return { stage: 2, label: "Holding",   hue: "#B79A5C" };
  return                    { stage: 1, label: "Wilting",   hue: "#B7714A" };
}

/**
 * PlantGlyph - a small SVG plant whose form reflects a growth stage (1-4).
 * Stage 4: upright with two full leaves and a bud.
 * Stage 3: upright with one full leaf, one budding.
 * Stage 2: leaning, smaller leaves.
 * Stage 1: drooping, wilted.
 *
 * All three are drawn from the same skeleton so plants in the grove look
 * like siblings, just at different points in their day.
 */
function PlantGlyph({ stage = 4, hue = "#5C9670", size = 90 }) {
  // Stems and leaves are described as percentages of viewBox so size scales cleanly.
  const stems = {
    4: { stem: "M50 80 C 50 64, 50 48, 50 34", leafR: "M50 50 C 62 44, 76 36, 84 22 C 78 38, 66 50, 56 56 Z", leafL: "M50 58 C 38 52, 24 44, 16 30 C 22 46, 34 58, 44 64 Z", bud: true },
    3: { stem: "M50 80 C 50 66, 50 52, 50 40", leafR: "M50 55 C 60 50, 72 44, 78 32 C 74 46, 64 55, 56 60 Z", leafL: "M50 62 C 42 58, 32 52, 28 44 C 32 54, 40 62, 46 66 Z", bud: false },
    2: { stem: "M50 82 C 50 70, 56 58, 60 48", leafR: "M58 58 C 70 56, 78 50, 82 42 C 76 52, 68 60, 62 62 Z", leafL: "M52 70 C 44 66, 38 60, 36 54 C 40 62, 46 68, 50 72 Z", bud: false },
    1: { stem: "M50 82 C 52 72, 62 64, 70 60", leafR: "M68 62 C 76 64, 82 62, 86 56 C 80 64, 74 66, 70 65 Z", leafL: "M48 76 C 42 76, 36 74, 32 70 C 38 76, 44 78, 50 78 Z", bud: false },
  }[stage] || { stem: "M50 80 L 50 40", leafR: "", leafL: "", bud: false };

  const soft = `${hue}AA`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Defs>
        <RadialGradient id={`pgrad-${stage}-${hue.replace("#", "")}`} cx="50" cy="80" rx="38" ry="14">
          <Stop offset="0" stopColor={hue} stopOpacity={0.20} />
          <Stop offset="1" stopColor={hue} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx="50" cy="86" rx="38" ry="6" fill={`url(#pgrad-${stage}-${hue.replace("#", "")})`} />
      {/* soil */}
      <Path d="M22 84 C 35 78, 65 78, 78 84 C 78 90, 22 90, 22 84 Z" fill={stage === 1 ? "#C8B8A0" : "#D8E2D2"} />
      {/* stem */}
      <Path d={stems.stem} stroke={hue} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      {/* leaves */}
      {stems.leafR && <Path d={stems.leafR} fill={hue} />}
      {stems.leafL && <Path d={stems.leafL} fill={soft} />}
      {/* bud (only stage 4) */}
      {stems.bud && (
        <Path d="M47 34 C 47 30, 53 30, 53 34 C 53 38, 47 38, 47 34 Z" fill={hue} />
      )}
    </Svg>
  );
}

const cleanUsername = (raw) =>
  (raw || "").trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
const CHALLENGE_CACHE_EPOCH = "challenge-reset-2026-06-05";
const LOADING_MESSAGES = ["Almost there", "Working on it", "Syncing updates", "Still loading"];

function smoothUpdate(fn) {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  fn();
}

function getStake(challenge) {
  const penaltyMins = challenge.type === "dare" ? 30 : 15;
  const xp = challenge.type === "dare" ? 20 : 30;
  return { penaltyMins, xp };
}

function isSubActive(profile) {
  if (!profile?.sub_active) return false;
  return !profile.sub_expires || new Date(profile.sub_expires) > new Date();
}

function Avatar({ username = "?", uri, size = 42 }) {
  const initials = username.slice(0, 2).toUpperCase();
  const hue = username.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  if (uri && !uri.startsWith?.("data:image/")) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#234" }} />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: `hsl(${hue},32%,28%)`,
      alignItems: "center", justifyContent: "center",
    }}>
      <Text style={{ color: `hsl(${hue},55%,78%)`, fontSize: size * 0.34, fontWeight: "700" }}>{initials}</Text>
    </View>
  );
}

/**
 * FriendPlant - a single tile in the grove. Replaces the old row-style
 * FriendRow. Each plant's growth state visually reflects the friend's
 * focus today. Tap to open stats; the challenge action lives there.
 */
function FriendPlant({ friend, onPress, dark }) {
  const th = palette(dark);
  const minutes = friend.minutes || 0;
  const g = growthState(minutes);

  return (
    <TouchableOpacity
      onPress={() => onPress(friend)}
      activeOpacity={0.85}
      pointerEvents="box-only"
      style={{
        paddingTop: 6,
        paddingBottom: 14,
        paddingHorizontal: 8,
        alignItems: "center",
        transform: [{
          translateY: (friend.username || "").charCodeAt(0) % 2 === 0 ? 0 : 8,
        }],
      }}
    >
      <PlantGlyph stage={g.stage} hue={g.hue} size={118} />
      <View style={{
        marginTop: -4,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: th.card,
        borderWidth: 1,
        borderColor: th.hairline,
        maxWidth: "100%",
      }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: FF.bodyMed,
            fontSize: 12,
            color: th.ink,
            maxWidth: "100%",
          }}
        >
          @{friend.username}
        </Text>
      </View>
      <View style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: g.hue,
        marginTop: 6,
      }} />
    </TouchableOpacity>
  );
}

function LoadingState({ elapsedMs, dark }) {
  const th = palette(dark);
  if (elapsedMs < 2000) return <View style={{ minHeight: 96 }} />;
  if (elapsedMs < 4000) {
    return <ActivityIndicator color={th.sage} style={{ marginTop: 40 }} />;
  }
  const dynamic = elapsedMs >= 5000;
  const text = dynamic
    ? LOADING_MESSAGES[Math.floor(elapsedMs / 1100) % LOADING_MESSAGES.length]
    : "Tending the grove";
  return (
    <View style={{ minHeight: 120, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: FF.body, fontSize: 13, color: th.mid }}>{text}</Text>
    </View>
  );
}

function FriendStatsModal({ friend, dark, onClose, onChallenge, isPremium }) {
  const th = palette(dark);
  if (!friend) return null;
  const fmt = m => !m ? "0m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  const g = growthState(friend.minutes || 0);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{
        flex: 1,
        backgroundColor: "rgba(11,26,17,0.55)",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}>
        <Pressable onPress={(e) => e.stopPropagation?.()} style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 28,
          backgroundColor: th.card,
          padding: 26,
          paddingTop: 22,
          borderWidth: 1,
          borderColor: th.hairline,
          overflow: "hidden",
        }}>
          <TouchableOpacity
            onPress={onClose}
            style={{
              position: "absolute", top: 14, right: 14, zIndex: 2,
              width: 32, height: 32, borderRadius: 16,
              alignItems: "center", justifyContent: "center",
              backgroundColor: th.card2,
            }}
          >
            <CloseIcon size={14} color={th.mid} />
          </TouchableOpacity>

          {/* Plant glyph centered */}
          <View style={{ alignItems: "center", marginBottom: 8 }}>
            <PlantGlyph stage={g.stage} hue={g.hue} size={110} />
          </View>

          <Text style={{
            fontFamily: FF.kicker, fontSize: 9, color: th.faint,
            letterSpacing: 2.4, textAlign: "center", marginBottom: 4,
          }}>
            PLANT
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: FF.display, fontSize: 32, color: th.ink,
              letterSpacing: -0.4, textAlign: "center", marginBottom: 8,
            }}
          >
            @{friend.username}
          </Text>
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "center",
            gap: 6, marginBottom: 22,
          }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: g.hue }} />
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 12, color: th.mid }}>
              {g.label}
            </Text>
          </View>

          {/* Stat tiles */}
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 18 }}>
            <View style={{
              flex: 1, borderRadius: 18, padding: 16,
              backgroundColor: th.card2,
              borderWidth: 1, borderColor: th.hairline,
            }}>
              <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: th.faint, letterSpacing: 1.6, marginBottom: 4 }}>
                SCREEN TIME
              </Text>
              <Text style={{ fontFamily: FF.display, fontSize: 26, color: th.ink, letterSpacing: -0.4 }}>
                {fmt(friend.minutes || 0)}
              </Text>
            </View>
            <View style={{
              flex: 1, borderRadius: 18, padding: 16,
              backgroundColor: th.card2,
              borderWidth: 1, borderColor: th.hairline,
            }}>
              <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: th.faint, letterSpacing: 1.6, marginBottom: 4 }}>
                SESSIONS
              </Text>
              <Text style={{ fontFamily: FF.display, fontSize: 26, color: th.ink, letterSpacing: -0.4 }}>
                {friend.unlocks || 0}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => {
              onClose();
              isPremium ? onChallenge(friend) : onChallenge(null);
            }}
            activeOpacity={0.85}
            style={{
              paddingVertical: 14,
              borderRadius: 16,
              backgroundColor: th.deep,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {!isPremium && <LockIcon size={14} color={dark ? "#1F3A2A" : "#FAF6EE"} />}
            <Text style={{
              fontFamily: FF.bodyMed,
              fontSize: 14,
              color: dark ? "#1F3A2A" : "#FAF6EE",
              letterSpacing: 0.2,
            }}>
              {isPremium ? "Challenge" : "Upgrade to challenge"}
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChallengeRow({ item, myId, dark, onPress, onVerify }) {
  const th = palette(dark);
  const incoming = item.challenged_id === myId && item.status === "pending";
  const outgoingPending = item.challenger_id === myId && item.status === "pending";
  const mineDone = item.challenger_id === myId ? item.challenger_done : item.challenged_done;
  const label = item.title || item.exercise?.replace(/_/g, " ") || "Challenge";
  const fromName = item.challenger?.username || item.challenger_username || "friend";
  const toName = item.challenged?.username || "friend";
  const stake = getStake(item);
  const kicker = incoming ? "NEW" : outgoingPending ? "AWAITING REPLY" : item.status === "active" ? "ACTIVE" : "CHALLENGE";

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      pointerEvents="box-only"
      onPress={() => incoming || outgoingPending ? onPress(item) : (!mineDone && item.status === "active" ? onVerify(item) : onPress(item))}
      style={{
        flexDirection: "row", alignItems: "center", gap: 12,
        padding: 16,
        borderRadius: 18,
        backgroundColor: th.card,
        borderWidth: 1, borderColor: th.hairline,
      }}
    >
      <View style={{
        width: 40, height: 40, borderRadius: 20,
        alignItems: "center", justifyContent: "center",
        backgroundColor: incoming ? th.washStrong : th.wash,
      }}>
        <LeafGlyph size={18} color={th.sage} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: th.sage, letterSpacing: 1.6, marginBottom: 2 }}>
          {kicker}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: FF.bodyMed, fontSize: 14, color: th.ink, textTransform: "capitalize" }}
        >
          {incoming ? `@${fromName}` : outgoingPending ? `To @${toName}` : label}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: FF.body, fontSize: 11, color: th.mid, marginTop: 2 }}
        >
          {incoming ? label : outgoingPending ? "Waiting for them to accept" : mineDone ? "Waiting for result" : "Tap to verify"}
        </Text>
      </View>
      <View style={{
        alignItems: "flex-end",
        paddingLeft: 8,
        borderLeftWidth: 0.5, borderLeftColor: th.hairline,
      }}>
        <Text style={{ fontFamily: FF.bodyBold, fontSize: 13, color: th.sage }}>
          +{stake.xp} XP
        </Text>
        <Text style={{ fontFamily: FF.body, fontSize: 11, color: th.clay, marginTop: 1 }}>
          -{stake.penaltyMins}m
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function ChallengeDetailModal({ challenge, myId, dark, accepting, acceptedBurst, onAccept, onDecline, onClose }) {
  const th = palette(dark);
  if (!challenge) return null;
  const stake = getStake(challenge);
  const label = challenge.title || challenge.exercise?.replace(/_/g, " ") || "Challenge";
  const fromName = challenge.challenger?.username || "friend";
  const canRespond = challenge.status === "pending" && challenge.challenged_id === myId;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{
        flex: 1, backgroundColor: "rgba(11,26,17,0.55)",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}>
        <Pressable onPress={(e) => e.stopPropagation?.()} style={{
          width: "100%", maxWidth: 420,
          backgroundColor: th.card, borderRadius: 28, padding: 26,
          borderWidth: 1, borderColor: th.hairline,
          overflow: "hidden",
        }}>
          <TouchableOpacity
            onPress={onClose}
            style={{
              position: "absolute", top: 14, right: 14, zIndex: 2,
              width: 32, height: 32, borderRadius: 16,
              alignItems: "center", justifyContent: "center",
              backgroundColor: th.card2,
            }}
          >
            <CloseIcon size={14} color={th.mid} />
          </TouchableOpacity>

          <Text style={{
            fontFamily: FF.kicker, fontSize: 9, color: th.sage,
            letterSpacing: 2.4, marginBottom: 8,
          }}>
            CHALLENGE FROM @{fromName.toUpperCase()}
          </Text>
          <Text style={{
            fontFamily: FF.display, fontSize: 30, color: th.ink,
            letterSpacing: -0.4, textTransform: "capitalize",
            marginBottom: 10,
          }}>
            {label}
          </Text>
          {!!challenge.description && (
            <Text style={{ fontFamily: FF.body, fontSize: 13, color: th.mid, lineHeight: 20 }}>
              {challenge.description}
            </Text>
          )}

          <View style={{
            backgroundColor: th.card2,
            borderRadius: 18, padding: 16, marginTop: 16,
            borderWidth: 1, borderColor: th.hairline,
          }}>
            <Text style={{ fontFamily: FF.bodyBold, fontSize: 14, color: th.ink, marginBottom: 4 }}>
              First verified wins +{stake.xp} XP
            </Text>
            <Text style={{ fontFamily: FF.body, fontSize: 12, color: th.mid, lineHeight: 18 }}>
              The other person loses {stake.penaltyMins} minutes of screen time.
            </Text>
          </View>

          {acceptedBurst && (
            <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    width: 7, height: 7, borderRadius: 4,
                    backgroundColor: th.sage, opacity: 0.55,
                    transform: [{ rotate: `${i * 60}deg` }, { translateY: -34 }],
                  }}
                />
              ))}
            </View>
          )}

          {canRespond ? (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <TouchableOpacity
                onPress={() => onDecline(challenge.id)}
                disabled={accepting}
                style={{
                  flex: 1, paddingVertical: 14, borderRadius: 14,
                  borderWidth: 1, borderColor: th.hairline,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: th.mid }}>Deny</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onAccept(challenge.id)}
                disabled={accepting}
                style={{
                  flex: 1, paddingVertical: 14, borderRadius: 14,
                  backgroundColor: th.deep,
                  alignItems: "center",
                }}
              >
                <Text style={{
                  fontFamily: FF.bodyMed, fontSize: 14,
                  color: dark ? "#1F3A2A" : "#FAF6EE",
                }}>
                  {accepting ? "Accepting…" : "Accept"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={onClose}
              style={{
                marginTop: 18, paddingVertical: 14, borderRadius: 14,
                backgroundColor: th.deep, alignItems: "center",
              }}
            >
              <Text style={{
                fontFamily: FF.bodyMed, fontSize: 14,
                color: dark ? "#1F3A2A" : "#FAF6EE",
              }}>
                Close
              </Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChallengeOutcomeModal({ outcome, dark, onClose }) {
  const th = palette(dark);
  if (!outcome) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{
        flex: 1, backgroundColor: "rgba(11,26,17,0.55)",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}>
        <Pressable onPress={(e) => e.stopPropagation?.()} style={{
          width: "100%", maxWidth: 420,
          backgroundColor: th.card, borderRadius: 28, padding: 28,
          borderWidth: 1, borderColor: th.hairline,
          alignItems: "center",
        }}>
          <View style={{ marginBottom: 8 }}>
            <PlantGlyph
              stage={outcome.won ? 4 : 1}
              hue={outcome.won ? "#5C9670" : "#B7714A"}
              size={100}
            />
          </View>
          <Text style={{
            fontFamily: FF.kicker, fontSize: 10,
            color: outcome.won ? th.sage : th.clay,
            letterSpacing: 2.4, marginBottom: 4,
          }}>
            {outcome.won ? "CHALLENGE WON" : "CHALLENGE LOST"}
          </Text>
          <Text style={{
            fontFamily: FF.display, fontSize: 36, color: th.ink,
            letterSpacing: -0.5, marginBottom: 10,
          }}>
            {outcome.won ? `+${outcome.xp} XP` : `-${outcome.penaltyMins}m`}
          </Text>
          <Text style={{
            fontFamily: FF.body, fontSize: 13, color: th.mid,
            textAlign: "center", lineHeight: 20, marginBottom: 22,
          }}>
            {outcome.won
              ? "You verified first and claimed the reward."
              : "Your friend verified first, so the stake was applied."}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={{
              paddingVertical: 14, paddingHorizontal: 28,
              borderRadius: 14,
              backgroundColor: th.deep,
              width: "100%", alignItems: "center",
            }}
          >
            <Text style={{
              fontFamily: FF.bodyMed, fontSize: 14,
              color: dark ? "#1F3A2A" : "#FAF6EE",
            }}>
              Continue
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PastChallengeRow({ item, myId, dark }) {
  const th = palette(dark);
  const label = item.title || item.exercise?.replace(/_/g, " ") || "Challenge";
  const stake = getStake(item);
  const winnerName =
    item.winner_id === myId ? "you" :
    item.winner_id === item.challenger_id ? (item.challenger?.username || "friend") :
    item.winner_id === item.challenged_id ? (item.challenged?.username || "friend") :
    item.status === "declined" ? "declined" : "not set";
  const youWon = item.winner_id === myId;
  return (
    <View style={{
      backgroundColor: th.card,
      borderRadius: 16, padding: 14, marginBottom: 8,
      borderWidth: 1, borderColor: th.hairline,
      flexDirection: "row", alignItems: "center", gap: 12,
    }}>
      <View style={{
        width: 36, height: 36, borderRadius: 18,
        alignItems: "center", justifyContent: "center",
        backgroundColor: youWon ? th.wash : th.card2,
      }}>
        <LeafGlyph size={15} color={youWon ? th.sage : th.mid} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: th.ink, textTransform: "capitalize" }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ fontFamily: FF.body, fontSize: 11, color: th.mid, marginTop: 2 }}>
          {item.status === "declined"
            ? "Declined"
            : `${winnerName === "you" ? "You won" : `${winnerName} won`} · +${stake.xp} XP`}
        </Text>
      </View>
    </View>
  );
}

export default function SocialScreen({ userId, isPremium, onOpenPaywall, onSwipeLockChange, onChallengeResolved, dark = false }) {
  const th = palette(dark);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [challengeTarget, setChallengeTarget] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const [friendRequests, setFriendRequests] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [verifyingChallenge, setVerifyingChallenge] = useState(null);
  const [toast, setToast] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [selectedChallenge, setSelectedChallenge] = useState(null);
  const [acceptingChallenge, setAcceptingChallenge] = useState(false);
  const [acceptedBurst, setAcceptedBurst] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [knownChallengeStatus, setKnownChallengeStatus] = useState({});
  const [statsFriend, setStatsFriend] = useState(null);
  const showedCachedFriendsRef = useRef(false);

  useEffect(() => {
    onSwipeLockChange?.(!!challengeTarget || showAdd || !!selectedChallenge || !!statsFriend || showPast);
    return () => onSwipeLockChange?.(false);
  }, [challengeTarget, showAdd, selectedChallenge, statsFriend, showPast, onSwipeLockChange]);

  useEffect(() => {
    showedCachedFriendsRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!loading) {
      setLoadingElapsed(0);
      return undefined;
    }
    const startedAt = Date.now();
    const id = setInterval(() => setLoadingElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [loading]);

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    let { data, error } = await cached(`social_profile_${userId}`, 30_000, () => supabase
      .from("profiles")
      .select("id, username, avatar_url, sub_active, sub_expires")
      .eq("id", userId)
      .maybeSingle());
    if (error && /avatar_url|schema cache/i.test(error.message || "")) {
      const fallback = await supabase
        .from("profiles")
        .select("id, username, sub_active, sub_expires")
        .eq("id", userId)
        .maybeSingle();
      data = fallback.data;
    }
    if (data?.username) {
      setMyProfile(data);
      return;
    }

    const { data: { user } } = await cached(`auth_user_${userId}`, 60_000, () =>
      rateLimited(`auth_user_${userId}`, { limit: 20, windowMs: 60_000 }, () =>
        supabase.auth.getUser()
      )
    );
    const meta = user?.user_metadata || {};
    const base = cleanUsername(meta.username || meta.full_name);
    const candidate = base.length >= 3 ? base : ("drifter" + Math.random().toString(36).slice(2, 10));
      for (let i = 0; i < 5; i++) {
        const tryName = i === 0 ? candidate : `${candidate.slice(0, 18)}_${i + 1}`;
      let { data: inserted, error } = await rateLimited(`profile_create_${userId}`, { limit: 5, windowMs: 10 * 60_000 }, () =>
        supabase
          .from("profiles")
          .insert({ id: userId, username: tryName })
          .select("id, username, avatar_url, sub_active, sub_expires")
          .single()
      );
      if (error && /avatar_url|schema cache/i.test(error.message || "")) {
        const fallback = await supabase
          .from("profiles")
          .select("id, username, sub_active, sub_expires")
          .eq("id", userId)
          .maybeSingle();
        inserted = fallback.data;
        error = fallback.error;
      }
      if (!error) { setMyProfile(inserted); break; }
      if (!/duplicate|unique/i.test(error.message || "")) break;
    }
  }, [userId]);

  const loadFriends = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const cacheKey = `drift_friends_cache_${userId}`;
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached && !showedCachedFriendsRef.current) {
      try { smoothUpdate(() => setFriends(JSON.parse(cached))); } catch {}
      showedCachedFriendsRef.current = true;
    }
    const data = await getFriendsWithScreenTime(userId);
    if (data?.length || !cached) smoothUpdate(() => setFriends(data || []));
    if (data) AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  const loadRequests = useCallback(async () => {
    if (!userId) return;
    // 10s cache so a burst of friendship changes doesn't fan out into
    // multiple identical queries (saves egress).
    const data = await cached(`friend_reqs_${userId}`, 10_000, async () => {
      let { data, error } = await supabase
        .from("friendships")
        .select("id, user_id, profiles!friendships_user_id_fkey(username, avatar_url)")
        .eq("friend_id", userId)
        .eq("status", "pending");
      if (error && /avatar_url|schema cache/i.test(error.message || "")) {
        const fallback = await supabase
          .from("friendships")
          .select("id, user_id, profiles!friendships_user_id_fkey(username)")
          .eq("friend_id", userId)
          .eq("status", "pending");
        data = fallback.data;
      }
      return data || [];
    });
    smoothUpdate(() => setFriendRequests(data || []));
  }, [userId]);

  const loadChallenges = useCallback(async () => {
    if (!userId) return;
    const cutoffIso = new Date(Date.now() - SIX_MONTHS_MS).toISOString();
    // Explicit column list - avoid select("*") to keep egress small. This
    // query runs on every realtime change to the challenges table, so the
    // payload size matters. Add columns here as the UI starts using them.
    const COLS = [
      "id", "type", "status", "title", "exercise", "description",
      "secs", "duration_mins",
      "challenger_id", "challenged_id", "winner_id",
      "challenger_done", "challenged_done",
      "created_at",
    ].join(",");
    const join = (withAvatar) => withAvatar
      ? `${COLS}, challenger:profiles!challenges_challenger_id_fkey(username, avatar_url), challenged:profiles!challenges_challenged_id_fkey(username, avatar_url)`
      : `${COLS}, challenger:profiles!challenges_challenger_id_fkey(username), challenged:profiles!challenges_challenged_id_fkey(username)`;
    // Cache the result for 10s so back-to-back realtime events (e.g. an
    // accept that updates challenges + creates a friendship in quick
    // succession) don't fire two full refetches.
    const fetcher = async () => {
      let { data, error } = await supabase
        .from("challenges")
        .select(join(true))
        .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
        .in("status", ["pending", "active", "completed", "declined"])
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false });
      if (error && /avatar_url|schema cache/i.test(error.message || "")) {
        const fallback = await supabase
          .from("challenges")
          .select(join(false))
          .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
          .in("status", ["pending", "active", "completed", "declined"])
          .gte("created_at", cutoffIso)
          .order("created_at", { ascending: false });
        data = fallback.data;
      }
      return data || [];
    };
    const data = await cached(`challenges_${userId}`, 10_000, fetcher);
    smoothUpdate(() => setChallenges(data || []));
  }, [userId]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadProfile(), loadFriends(), loadRequests(), loadChallenges()]);
  }, [loadProfile, loadFriends, loadRequests, loadChallenges]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`social:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "challenges" }, loadChallenges)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => { loadRequests(); loadFriends(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, payload => smoothUpdate(() => setMyProfile(payload.new)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, loadChallenges, loadFriends, loadRequests]);

  // NOTE: we deliberately do NOT poll on an interval here. The realtime
  // postgres_changes subscription above pushes any change to friendships /
  // challenges / profiles within seconds, so polling every 8s was both
  // redundant AND was the single largest source of Supabase egress (each
  // tick re-ran loadChallenges with select("*") + two profile joins).
  // Use pull-to-refresh or screen-focus to force a manual reload instead.

  const addFriend = async () => {
    const username = cleanUsername(addUsername);
    if (!username) return;
    setAdding(true);
    try {
      // Exact (case-insensitive) match only. Wildcard `%q%` searches enable
      // username enumeration - never enable them.
      const { data: profile, error: lookupErr } = await rateLimited(`friend_lookup_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
        cached(`profile_lookup_${username}`, 30_000, () => supabase
          .from("profiles")
          .select("id, username")
          .ilike("username", username)
          .maybeSingle())
      );

      if (lookupErr) { Alert.alert("Lookup failed", "Please try again."); return; }
      if (!profile) { Alert.alert("Not found", `@${username} doesn't have a Drift account.`); return; }
      if (profile.id === userId) { Alert.alert("That's you", "You can't add yourself."); return; }

      const { data: reverse } = await supabase
        .from("friendships")
        .select("id")
        .eq("user_id", profile.id)
        .eq("friend_id", userId)
        .eq("status", "pending")
        .maybeSingle();

      if (reverse?.id) {
        await rateLimited(`friend_accept_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
          supabase.from("friendships").update({ status: "accepted" }).eq("id", reverse.id)
        );
        invalidateCache(`friends_screen_time_${userId}`);
        setToast(`You and @${profile.username} are now friends`);
        setTimeout(() => setToast(""), 2200);
        setAddUsername("");
        setShowAdd(false);
        loadAll();
        return;
      }

      const { error } = await rateLimited(`friend_request_${userId}`, { limit: 20, windowMs: 60_000 }, () =>
        supabase.from("friendships").insert({ user_id: userId, friend_id: profile.id, status: "pending" })
      );
      if (error && error.code !== "23505") Alert.alert("Error", error.message);
      else {
        setAddUsername("");
        setShowAdd(false);
        setToast(error?.code === "23505" ? "Request already sent" : `Friend request sent to @${profile.username}`);
        setTimeout(() => setToast(""), 2200);
        loadAll();
      }
    } finally {
      setAdding(false);
    }
  };

  const acceptRequest = async (id) => {
    await rateLimited(`friend_accept_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
      supabase.from("friendships").update({ status: "accepted" }).eq("id", id)
    );
    invalidateCache(`friends_screen_time_${userId}`);
    invalidateCache(`friend_reqs_${userId}`);
    smoothUpdate(() => setFriendRequests(p => p.filter(r => r.id !== id)));
    loadAll();
  };

  const handleChallenge = (friend) => {
    if (!friend) { onOpenPaywall?.(); return; }
    setChallengeTarget(friend);
  };

  const markChallengeDone = async (challenge) => {
    const mine = challenge.challenger_id === userId ? "challenger_done" : "challenged_done";
    const winnerId = challenge.winner_id || userId;
    await rateLimited(`challenge_done_${userId}`, { limit: 30, windowMs: 60_000 }, () => supabase.from("challenges").update({
      [mine]: true,
      status: "completed",
      winner_id: winnerId,
    }).eq("id", challenge.id));

    setVerifyingChallenge(null);
    invalidateCache(`challenges_${userId}`);
    loadChallenges();
  };

  const applyResolvedChallenge = useCallback(async (challenge) => {
    if (!challenge?.id || challenge.status !== "completed" || !challenge.winner_id) return;
    const appliedKey = `drift_challenge_stake_${CHALLENGE_CACHE_EPOCH}_${challenge.id}_${userId}`;
    const alreadyApplied = await AsyncStorage.getItem(appliedKey).catch(() => null);
    if (alreadyApplied) return;
    const stake = getStake(challenge);
    const won = challenge.winner_id === userId;
    onChallengeResolved?.({ won, ...stake, challenge });
    await AsyncStorage.setItem(appliedKey, "1").catch(() => {});
    setOutcome({ won, ...stake, challenge });
  }, [userId, onChallengeResolved]);

  useEffect(() => {
    if (!userId) return;
    challenges
      .filter(c => c.status === "completed" && c.winner_id)
      .forEach(c => { applyResolvedChallenge(c); });
  }, [challenges, userId, applyResolvedChallenge]);

  useEffect(() => {
    if (!userId || challenges.length === 0) return;
    setKnownChallengeStatus(prev => {
      const next = { ...prev };
      challenges.forEach(ch => {
        const id = String(ch.id);
        const oldStatus = prev[id];
        if (oldStatus && oldStatus === "pending" && ch.challenger_id === userId && ch.status !== "pending") {
          const name = ch.challenged?.username || "friend";
          const msg = ch.status === "active"
            ? `@${name} accepted your challenge`
            : ch.status === "declined"
              ? `@${name} denied your challenge`
              : "";
          if (msg) {
            setToast(msg);
            setTimeout(() => setToast(""), 2400);
          }
        }
        next[id] = ch.status;
      });
      return next;
    });
  }, [challenges, userId]);

  const visibleChallenges = useMemo(
    () => challenges.filter(c => c.status === "active" || c.status === "pending"),
    [challenges, userId]
  );
  const pastChallenges = useMemo(() => {
    const cutoff = Date.now() - SIX_MONTHS_MS;
    return challenges.filter(c => (
      (c.status === "completed" || c.status === "declined") &&
      (!c.created_at || new Date(c.created_at).getTime() >= cutoff)
    ));
  }, [challenges]);

  const acceptChallenge = async (id) => {
    setAcceptingChallenge(true);
    await rateLimited(`challenge_respond_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
      supabase.from("challenges").update({ status: "active" }).eq("id", id)
    );
    Vibration.vibrate(18);
    setAcceptedBurst(true);
    setTimeout(() => {
      setAcceptedBurst(false);
      setSelectedChallenge(null);
      setAcceptingChallenge(false);
      invalidateCache(`challenges_${userId}`);
      loadChallenges();
    }, 680);
  };

  const declineChallenge = async (id) => {
    await rateLimited(`challenge_respond_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
      supabase.from("challenges").update({ status: "declined" }).eq("id", id)
    );
    setSelectedChallenge(null);
    invalidateCache(`challenges_${userId}`);
    loadChallenges();
  };

  // Cancel a challenge YOU sent that hasn't been accepted yet.
  // SOFT delete - the row stays in the DB with status='cancelled' for audit.
  // Optimistic: remove from visible list immediately, roll back on failure.
  const cancelOutgoingChallenge = async (id) => {
    const before = challenges;
    smoothUpdate(() => setChallenges(prev => prev.filter(c => c.id !== id)));
    const { error } = await rateLimited(`challenge_cancel_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
      supabase
        .from("challenges")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id)
        .eq("challenger_id", userId) // RLS enforces this too
        .eq("status", "pending")
    );
    if (error) {
      setChallenges(before);
      Alert.alert("Couldn't cancel", error.message || "The other player may have already responded.");
    }
  };

  if (!userId) return (
    <View style={{
      flex: 1, alignItems: "center", justifyContent: "center",
      padding: 32, backgroundColor: th.bg,
    }}>
      <Sprout size={120} tone={dark ? "night" : "fresh"} />
      <Text style={{ fontFamily: FF.display, fontSize: 30, color: th.ink, letterSpacing: -0.3, marginTop: 12, marginBottom: 6 }}>
        Sign in to see the grove
      </Text>
      <Text style={{ fontFamily: FF.body, fontSize: 13, color: th.mid, textAlign: "center", lineHeight: 20 }}>
        Create an account to share your focus{"\n"}with friends.
      </Text>
    </View>
  );

  // Pair friends into rows of two for the asymmetric grove grid.
  const friendPairs = [];
  for (let i = 0; i < friends.length; i += 2) {
    friendPairs.push(friends.slice(i, i + 2));
  }

  const myGrowth = growthState(0); // self always shown thriving - we don't track our own screen time on this screen

  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      {!!toast && (
        <View style={{
          position: "absolute", top: 14, left: 18, right: 18, zIndex: 50,
          backgroundColor: th.deep, borderRadius: 16,
          paddingVertical: 12, paddingHorizontal: 16, alignItems: "center",
          shadowColor: "#1F3A2A", shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.12, shadowRadius: 14, elevation: 4,
        }} pointerEvents="none">
          <Text style={{
            fontFamily: FF.bodyMed, color: dark ? "#1F3A2A" : "#FAF6EE", fontSize: 13,
          }}>
            {toast}
          </Text>
        </View>
      )}

      {/* Grove canopy */}
      <View style={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6 }}>
        <Text style={{
          fontFamily: FF.kicker, fontSize: 10, color: th.faint,
          letterSpacing: 2.4, marginBottom: 6,
        }}>
          {friends.length} {friends.length === 1 ? "PLANT" : "PLANTS"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          <Text style={{
            fontFamily: FF.display, fontSize: 38, color: th.ink, letterSpacing: -0.5,
          }}>
            Grove
          </Text>
          <TouchableOpacity
            onPress={() => setShowAdd(v => !v)}
            activeOpacity={0.85}
            style={{
              width: 42, height: 42,
              borderRadius: 14, backgroundColor: th.deep,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Text style={{
              fontFamily: FF.body, fontSize: 22,
              color: dark ? "#1F3A2A" : "#FAF6EE", marginTop: -2,
            }}>
              {showAdd ? "x" : "+"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Inline add-friend row - appears under the header */}
      {showAdd && (
        <View style={{
          flexDirection: "row", gap: 8,
          paddingHorizontal: 22, paddingTop: 14, paddingBottom: 4,
        }}>
          <TextInput
            style={{
              flex: 1,
              backgroundColor: th.card, color: th.ink,
              fontFamily: FF.body, fontSize: 14,
              paddingVertical: 13, paddingHorizontal: 14,
              borderRadius: 14,
              borderWidth: 1, borderColor: th.hairline,
            }}
            placeholder="@username"
            placeholderTextColor={th.faint}
            value={addUsername}
            onChangeText={setAddUsername}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={addFriend}
            maxLength={30}
          />
          <TouchableOpacity
            onPress={addFriend}
            disabled={adding}
            activeOpacity={0.85}
            style={{
              paddingHorizontal: 18,
              borderRadius: 14,
              backgroundColor: th.deep,
              alignItems: "center", justifyContent: "center",
            }}
          >
            {adding ? <ActivityIndicator color={dark ? "#1F3A2A" : "#FAF6EE"} size="small" /> : (
              <Text style={{
                fontFamily: FF.bodyMed, fontSize: 13,
                color: dark ? "#1F3A2A" : "#FAF6EE",
              }}>
                Send
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <LoadingState elapsedMs={loadingElapsed} dark={dark} />
      ) : (
        <FlatList
          data={friendPairs}
          keyExtractor={(_, idx) => `pair_${idx}`}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(); }} tintColor={th.sage} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* Your username card - editorial, with leaf glyph */}
              {!!myProfile?.username && (
                <View style={{
                  flexDirection: "row", alignItems: "center", gap: 8,
                  marginBottom: 12,
                }}>
                  <TouchableOpacity
                    onPress={async () => {
                      if (Clipboard?.setStringAsync) {
                        await Clipboard.setStringAsync(`@${myProfile.username}`);
                        setCopiedFlag(true);
                        setTimeout(() => setCopiedFlag(false), 1400);
                      } else {
                        Share.share({ message: `@${myProfile.username}` }).catch(() => {});
                      }
                    }}
                    style={{
                      flex: 1,
                      flexDirection: "row", alignItems: "center", gap: 8,
                      backgroundColor: th.card,
                      borderRadius: 16,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: th.hairline,
                    }}
                  >
                    <LeafGlyph size={16} color={th.sage} />
                    <Text style={{ flex: 1, fontFamily: FF.bodyMed, fontSize: 13, color: th.ink }} numberOfLines={1}>
                      @{myProfile.username}
                    </Text>
                    {copiedFlag && (
                      <Text style={{ fontFamily: FF.body, fontSize: 11, color: th.sage }}>Copied</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      const link = `drift://add-friend/${myProfile.username}`;
                      Share.share({ message: `Add me on Drift: ${link}`, url: link }).catch(() => {});
                    }}
                    style={{
                      width: 42, height: 42, borderRadius: 14,
                      backgroundColor: th.card,
                      borderWidth: 1,
                      borderColor: th.hairline,
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <ShareIcon size={18} color={th.sage} strokeWidth={2.1} />
                  </TouchableOpacity>
                </View>
              )}

              {/* Friend requests - "seed packets" waiting to be planted */}
              {friendRequests.length > 0 && (
                <View style={{
                  marginBottom: 14, padding: 16,
                  borderRadius: 22,
                  backgroundColor: th.card2,
                  borderWidth: 1, borderColor: th.hairline,
                }}>
                  <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: th.faint, letterSpacing: 1.6, marginBottom: 10 }}>
                    SEEDS - {friendRequests.length}
                  </Text>
                  {friendRequests.map((r, idx) => (
                    <View key={r.id} style={{
                      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                      paddingVertical: 10,
                      borderTopWidth: idx === 0 ? 0 : 0.5, borderTopColor: th.hairline,
                    }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                        <View style={{
                          width: 30, height: 30, borderRadius: 15,
                          alignItems: "center", justifyContent: "center",
                          backgroundColor: th.wash,
                        }}>
                          <LeafGlyph size={14} color={th.sage} />
                        </View>
                        <Text
                          style={{ fontFamily: FF.bodyMed, fontSize: 14, color: th.ink }}
                          numberOfLines={1}
                        >
                          @{r.profiles?.username}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => acceptRequest(r.id)}
                        activeOpacity={0.85}
                        style={{
                          paddingVertical: 8, paddingHorizontal: 14,
                          borderRadius: 12,
                          backgroundColor: th.deep,
                        }}
                      >
                        <Text style={{
                          fontFamily: FF.bodyMed, fontSize: 12,
                          color: dark ? "#1F3A2A" : "#FAF6EE",
                        }}>
                          Plant
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Active / pending challenges */}
              {visibleChallenges.length > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={{
                    fontFamily: FF.kicker, fontSize: 9, color: th.faint, letterSpacing: 1.6,
                    marginBottom: 10, paddingLeft: 4,
                  }}>
                    CHALLENGES - {visibleChallenges.length}
                  </Text>
                  {visibleChallenges.map(ch => {
                    const canCancel = ch.challenger_id === userId && ch.status === "pending";
                    const row = (
                      <ChallengeRow
                        item={ch}
                        myId={userId}
                        dark={dark}
                        onPress={setSelectedChallenge}
                        onVerify={setVerifyingChallenge}
                      />
                    );
                    if (!canCancel) {
                      return <View key={ch.id} style={{ marginBottom: 8 }}>{row}</View>;
                    }
                    return (
                      <View key={ch.id} style={{ marginBottom: 8 }}>
                        <Swipeable
                          onDelete={() => cancelOutgoingChallenge(ch.id)}
                          confirmTitle="Cancel this challenge?"
                          confirmMessage={`The challenge to @${ch.challenged?.username || "friend"} will be withdrawn.`}
                        >
                          {row}
                        </Swipeable>
                      </View>
                    );
                  })}
                </View>
              )}

              {!isPremium && (
                <TouchableOpacity
                  onPress={onOpenPaywall}
                  activeOpacity={0.85}
                  style={{
                    marginBottom: 16,
                    paddingVertical: 12, paddingHorizontal: 14,
                    borderRadius: 14,
                    backgroundColor: th.card,
                    borderWidth: 1, borderColor: th.hairline,
                    flexDirection: "row", alignItems: "center", gap: 10,
                  }}
                >
                  <View style={{
                    width: 28, height: 28, borderRadius: 14,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: th.wash,
                  }}>
                    <LockIcon size={13} color={th.sage} />
                  </View>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: th.ink, flex: 1 }}>
                    Challenges
                  </Text>
                  <Text style={{ fontFamily: FF.serifReg, fontSize: 20, color: th.faint }}>{"›"}</Text>
                </TouchableOpacity>
              )}

            </>
          }
          ListFooterComponent={
            <View style={{ marginTop: "auto", paddingTop: 18, paddingBottom: 10, alignItems: "center" }}>
              <TouchableOpacity
                onPress={() => setShowPast(true)}
                activeOpacity={0.85}
                style={{
                  minWidth: 132,
                  height: 42,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  backgroundColor: th.card,
                  borderWidth: 1, borderColor: th.hairline,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: th.ink }}>
                  Archive
                </Text>
                <View style={{
                  minWidth: 22,
                  height: 22,
                  paddingHorizontal: 6,
                  borderRadius: 11,
                  backgroundColor: th.wash,
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 11, color: th.mid }}>
                    {pastChallenges.length}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item: pair }) => (
            <View style={{
              flexDirection: "row",
              gap: 12,
              marginBottom: 12,
              alignItems: "flex-start",
              backgroundColor: th.card2,
              borderWidth: 1,
              borderColor: th.hairline,
              borderRadius: 28,
              paddingVertical: 12,
              paddingHorizontal: 10,
              overflow: "hidden",
            }}>
              {pair.map(f => (
                <View key={f.id} style={{ flex: 1 }}>
                  <FriendPlant friend={f} onPress={setStatsFriend} dark={dark} />
                </View>
              ))}
              {/* If the row only has one friend, pad with an empty cell so it stays left */}
              {pair.length === 1 && <View style={{ flex: 1 }} />}
            </View>
          )}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 24 }}>
              <View style={{
                paddingVertical: 28, paddingHorizontal: 22,
                borderRadius: 24,
                borderWidth: 1.4, borderColor: dark ? "rgba(255,255,255,0.18)" : "rgba(26,40,32,0.18)",
                borderStyle: "dashed",
                alignItems: "center",
                width: "100%",
              }}>
                <Sprout size={120} tone={dark ? "night" : "fresh"} />
                <Text style={{
                  fontFamily: FF.display, fontSize: 28, color: th.ink,
                  letterSpacing: -0.3, marginTop: 4, marginBottom: 6,
                }}>
                  No plants yet
                </Text>
                <Text style={{
                  fontFamily: FF.body, fontSize: 13, color: th.mid,
                  textAlign: "center", lineHeight: 20, marginBottom: 18,
                }}>
                  Plant a friend by username.
                </Text>
                <TouchableOpacity
                  onPress={() => setShowAdd(true)}
                  activeOpacity={0.85}
                  style={{
                    paddingVertical: 12, paddingHorizontal: 18, borderRadius: 13,
                    backgroundColor: th.deep,
                    flexDirection: "row", alignItems: "center", gap: 8,
                  }}
                >
                  <Text style={{
                    fontFamily: FF.body, fontSize: 15,
                    color: dark ? "#1F3A2A" : "#FAF6EE", marginTop: -1,
                  }}>
                    +
                  </Text>
                  <Text style={{
                    fontFamily: FF.bodyMed, fontSize: 13,
                    color: dark ? "#1F3A2A" : "#FAF6EE",
                  }}>
                    Plant friend
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          }
          contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 152, flexGrow: 1 }}
        />
      )}

      {challengeTarget && (
        <ChallengeSheet
          userId={userId}
          target={challengeTarget}
          userIsPremium={isPremium}
          onSwipeLockChange={onSwipeLockChange}
          onSent={() => { setChallengeTarget(null); loadChallenges(); }}
          onClose={() => setChallengeTarget(null)}
          dark={dark}
        />
      )}

      <AICheckModal
        visible={!!verifyingChallenge}
        task={verifyingChallenge ? {
          title: verifyingChallenge.title || verifyingChallenge.exercise,
          minutes: verifyingChallenge.duration_mins || Math.ceil((verifyingChallenge.secs || 60) / 60),
        } : null}
        onVerified={() => markChallengeDone(verifyingChallenge)}
        onCancel={() => setVerifyingChallenge(null)}
        dark={dark}
      />

      <ChallengeDetailModal
        challenge={selectedChallenge}
        myId={userId}
        dark={dark}
        accepting={acceptingChallenge}
        acceptedBurst={acceptedBurst}
        onAccept={acceptChallenge}
        onDecline={declineChallenge}
        onClose={() => setSelectedChallenge(null)}
      />

      <ChallengeOutcomeModal
        outcome={outcome}
        dark={dark}
        onClose={() => setOutcome(null)}
      />

      <FriendStatsModal
        friend={statsFriend}
        dark={dark}
        onClose={() => setStatsFriend(null)}
        onChallenge={handleChallenge}
        isPremium={isPremium}
      />

      <Modal visible={showPast} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPast(false)}>
        <View style={{ flex: 1, backgroundColor: th.bg }}>
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 22, paddingTop: 54, paddingBottom: 16,
          }}>
            <View>
              <Text style={{
                fontFamily: FF.kicker, fontSize: 10, color: th.faint, letterSpacing: 2.4, marginBottom: 4,
              }}>
                ARCHIVE
              </Text>
              <Text style={{
                fontFamily: FF.display, fontSize: 28, color: th.ink, letterSpacing: -0.4,
              }}>
                Past challenges
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowPast(false)}
              style={{
                paddingHorizontal: 14, paddingVertical: 9,
                borderRadius: 12,
                backgroundColor: th.deep,
              }}
            >
              <Text style={{
                fontFamily: FF.bodyMed, fontSize: 12,
                color: dark ? "#1F3A2A" : "#FAF6EE",
              }}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={pastChallenges}
            keyExtractor={item => String(item.id)}
            renderItem={({ item }) => <PastChallengeRow item={item} myId={userId} dark={dark} />}
            ListEmptyComponent={
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
                <Sprout size={100} tone={dark ? "night" : "fresh"} />
                <Text style={{
                  fontFamily: FF.display, fontSize: 24, color: th.ink, letterSpacing: -0.3,
                  marginTop: 6, marginBottom: 6,
                }}>
                  No past challenges
                </Text>
                <Text style={{ fontFamily: FF.body, fontSize: 13, color: th.mid, textAlign: "center" }}>
                  Nothing archived yet.
                </Text>
              </View>
            }
            contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40, flexGrow: 1 }}
          />
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 48, paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: { fontFamily: FD, fontSize: 30, fontWeight: "300" },
  addBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: terra },
  addBtnText: { color: terra, fontSize: 14, fontWeight: "800" },
  addRow: { flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 0.5 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, fontSize: 14 },
  sendBtn: { paddingHorizontal: 18, borderRadius: 12, backgroundColor: terra, alignItems: "center", justifyContent: "center" },
  sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  usernameCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, padding: 14, borderWidth: 1, marginBottom: 12 },
  cardKicker: { fontFamily: FK, fontSize: 10, letterSpacing: 1.4, marginBottom: 2 },
  usernameText: { fontFamily: FK, fontSize: 20 },
  compactSolid: { backgroundColor: terra, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  compactSolidText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  pendingBox: { padding: 12, borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  pendingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8 },
  pendingName: { fontSize: 14, fontWeight: "700" },
  challengeBox: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
  challengeKicker: { fontFamily: FK, fontSize: 9, letterSpacing: 1.2, marginBottom: 2 },
  challengeTitle: { fontFamily: FK, fontSize: 15 },
  challengeSub: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  smallSolid: { backgroundColor: terra, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8 },
  smallGhost: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8 },
  trialBanner: { marginBottom: 12, padding: 11, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  trialText: { fontSize: 12, fontWeight: "700" },
  pastButton: { borderWidth: 1, borderRadius: 16, padding: 14, alignItems: "center", marginTop: 8 },
  pastButtonText: { fontFamily: FK, fontSize: 16 },
  pastHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 54, paddingBottom: 14, borderBottomWidth: 0.5 },
  pastRow: { borderWidth: 1, borderRadius: 15, padding: 14, marginBottom: 9 },
  row: { padding: 14, marginBottom: 10, borderWidth: 1, borderRadius: 18 },
  friendIdentity: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 16, fontWeight: "800" },
  friendMeta: { fontSize: 12, fontWeight: "600", marginTop: 3 },
  barBg: { height: 5, borderRadius: 3, overflow: "hidden", marginTop: 12 },
  barFill: { height: 5, borderRadius: 3 },
  friendActions: { flexDirection: "row", gap: 10, marginTop: 13 },
  statsBtn: { flex: 0.9, minHeight: 44, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  statsBtnText: { fontSize: 13, fontWeight: "800" },
  chalBtn: { flex: 1.15, minHeight: 46, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chalBtnText: { color: terra, fontSize: 14, fontWeight: "900" },
  loadingSpace: { minHeight: 96 },
  loadingTextWrap: { minHeight: 120, alignItems: "center", justifyContent: "center" },
  loadingText: { fontSize: 13, fontWeight: "800" },
  statsProfileHead: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16, paddingRight: 36 },
  statsGrid: { flexDirection: "row", gap: 10, borderTopWidth: 1, paddingTop: 14 },
  statTile: { flex: 1, borderRadius: 15, padding: 13 },
  statValue: { fontFamily: FK, fontSize: 20 },
  statLabel: { fontSize: 11, fontWeight: "700", marginTop: 3 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontFamily: FD, fontSize: 22, marginBottom: 8 },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  toast: {
    position: "absolute", top: 14, left: 18, right: 18, zIndex: 50,
    backgroundColor: terra, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
    alignItems: "center",
  },
  toastText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  modalShade: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  detailCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
    overflow: "hidden",
  },
  detailClose: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  detailTitle: { fontFamily: FK, fontSize: 26, marginTop: 6, marginBottom: 8 },
  detailBody: { fontSize: 13, lineHeight: 20 },
  detailStake: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 16 },
  detailStakeText: { fontFamily: FK, fontSize: 16, marginBottom: 4 },
  detailActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  detailGhost: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 14, alignItems: "center" },
  detailSolid: { flex: 1, borderRadius: 14, padding: 14, alignItems: "center", backgroundColor: terra },
  continueBtn: { flex: 0, marginTop: 18, width: "100%" },
  continueText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  burstWrap: {
    position: "absolute",
    left: 0, right: 0, top: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  burstDot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: terra,
    opacity: 0.55,
  },
});


