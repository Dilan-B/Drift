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
const COMMIT  = 44;   // shorter travel keeps the row open more reliably
const CAPTURE = 4;    // claim early so the ScrollView/tab swipe does not steal it

export default function Swipeable({
  children,
  onDelete,
  confirmTitle = "Delete?",
  confirmMessage = "This can't be undone.",
  height,
  disabled = false,
  rowStyle,
  // Fired true the instant this row claims a horizontal gesture, and false when
  // it ends. The parent uses this to suspend its tab-swipe so a delete drag can
  // never also switch tabs.
  onActiveChange,
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
      onStartShouldSetPanResponderCapture: () => {
        if (opened.current) close();
        return false;
      },
      onMoveShouldSetPanResponderCapture: (_, gs) => {
        if (disabled) return false;
        const horizontal = Math.abs(gs.dx) > Math.abs(gs.dy) * 1.05;
        const isLeft  = gs.dx < -CAPTURE;
        const isRight = gs.dx >  CAPTURE && opened.current;
        return horizontal && (isLeft || isRight);
      },
      onMoveShouldSetPanResponder: (_, gs) => {
        if (disabled) return false;
        // Only leftward, clearly horizontal, with a small threshold.
        // If already open, allow rightward swipes too (to close).
        const horizontal = Math.abs(gs.dx) > Math.abs(gs.dy) * 1.05;
        const isLeft  = gs.dx < -CAPTURE;
        const isRight = gs.dx >  CAPTURE && opened.current;
        return horizontal && (isLeft || isRight);
      },
      onPanResponderGrant: () => {
        onActiveChange?.(true);
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gs) => {
        const base = opened.current ? -REVEAL : 0;
        const next = Math.max(-REVEAL - 20, Math.min(0, base + gs.dx));
        tx.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        onActiveChange?.(false);
        const base = opened.current ? -REVEAL : 0;
        const final = base + gs.dx;
        if (final <= -COMMIT || gs.vx < -0.25) open();
        else                  close();
      },
      onPanResponderTerminate: () => {
        onActiveChange?.(false);
        if (opened.current) open(); else close();
      },
    })
  ).current;

  return (
    <View
      onTouchStart={() => {
        if (!disabled) onActiveChange?.(true);
      }}
      onTouchEnd={() => onActiveChange?.(false)}
      onTouchCancel={() => onActiveChange?.(false)}
      style={[{ position: "relative", overflow: "hidden", borderRadius: 18 }, height ? { height } : null]}
    >
      {/* Underlay — visible behind the row when swiped open */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0,
          width: REVEAL,
          backgroundColor: "#E05050",
          borderRadius: 18,
          alignItems: "center", justifyContent: "center",
          opacity: tx.interpolate({
            inputRange: [-12, -2, 0],
            outputRange: [1, 0, 0],
            extrapolate: "clamp",
          }),
        }}
      >
        <TouchableOpacity onPress={askDelete} style={{ width: REVEAL, height: "100%", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13, letterSpacing: 1 }}>DELETE</Text>
        </TouchableOpacity>
      </Animated.View>

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
