/**
 * Swipeable.jsx
 * Swipe-left-to-delete row. Used for task rows and pending challenges.
 *
 * Gesture priority:
 *   - Only captures on clear horizontal-left intent (dx<0, ratio > vertical)
 *   - Captures at a small threshold (8px) so it claims the touch BEFORE the
 *     parent tab-swipe responder (which requires ~28px to claim). This means
 *     a swipe on a row never accidentally triggers a tab change.
 *   - Returns false for rightward / upward / downward gestures so vertical
 *     scrolling in the parent ScrollView still works.
 */
import React, { useRef } from "react";
import {
  View, Text, TouchableOpacity, Animated, PanResponder, Alert,
} from "react-native";

const REVEAL  = 96;   // how far the row slides to expose the delete action
const COMMIT  = 80;   // dx threshold below which the row snaps back
const CAPTURE = 8;    // small threshold so we claim before parent tabSwipe

export default function Swipeable({
  children,
  onDelete,
  confirmTitle = "Delete?",
  confirmMessage = "This can't be undone.",
  height,
  disabled = false,
  rowStyle,
}) {
  const tx          = useRef(new Animated.Value(0)).current;
  const opened      = useRef(false);

  const close = () => {
    opened.current = false;
    Animated.spring(tx, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
  };
  const open = () => {
    opened.current = true;
    Animated.spring(tx, { toValue: -REVEAL, useNativeDriver: true, friction: 8, tension: 60 }).start();
  };

  const performDelete = () => {
    // Slide off-screen, then fire callback so parent can remove the row
    Animated.timing(tx, {
      toValue: -600, duration: 220, useNativeDriver: true,
    }).start(() => {
      onDelete?.();
    });
  };

  const askDelete = () => {
    Alert.alert(confirmTitle, confirmMessage, [
      { text: "Cancel", style: "cancel", onPress: close },
      { text: "Delete", style: "destructive", onPress: performDelete },
    ]);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        if (disabled) return false;
        // Only leftward, clearly horizontal, with a small threshold.
        // If already open, allow rightward swipes too (to close).
        const horizontal = Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5;
        const isLeft  = gs.dx < -CAPTURE;
        const isRight = gs.dx >  CAPTURE && opened.current;
        return horizontal && (isLeft || isRight);
      },
      // Don't let the parent steal mid-gesture
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gs) => {
        const base = opened.current ? -REVEAL : 0;
        const next = Math.max(-REVEAL - 20, Math.min(0, base + gs.dx));
        tx.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        const base = opened.current ? -REVEAL : 0;
        const final = base + gs.dx;
        if (final <= -COMMIT) open();
        else                  close();
      },
      onPanResponderTerminate: () => {
        if (opened.current) open(); else close();
      },
    })
  ).current;

  return (
    <View style={[{ position: "relative", overflow: "hidden", borderRadius: 16 }, height ? { height } : null]}>
      {/* Underlay — visible behind the row when swiped open */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0,
          width: REVEAL,
          backgroundColor: "#E05050",
          borderRadius: 16,
          alignItems: "center", justifyContent: "center",
        }}
      >
        <TouchableOpacity onPress={askDelete} style={{ width: REVEAL, height: "100%", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13, letterSpacing: 1 }}>DELETE</Text>
        </TouchableOpacity>
      </View>

      {/* The actual row */}
      <Animated.View
        {...responder.panHandlers}
        style={[{ transform: [{ translateX: tx }] }, rowStyle]}
      >
        {children}
      </Animated.View>
    </View>
  );
}
