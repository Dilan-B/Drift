/**
 * Anim.jsx
 * Lightweight animation toolkit for Drift.
 *
 *  - TouchTracker    : invisible root wrapper that remembers WHERE the user
 *                      last tapped (screen coords). No props needed.
 *  - getLastTouch()  : read the last tap point { x, y }.
 *  - OriginPanel     : wraps modal/sheet content and animates it growing OUT of
 *                      the last tap point, and shrinking back INTO it on close.
 *  - Pop             : press-to-scale feedback wrapper (springy button feel).
 *  - FadeInUp        : mount animation — content rises + fades in.
 *  - Pulse           : gentle infinite breathing scale (for "live" accents).
 *  - useStagger      : returns a delay for list items so they cascade in.
 */
import React, {
  useRef, useEffect, useState, useCallback, createContext, useContext,
} from "react";
import { Animated, View, Dimensions, Easing, Pressable, Modal } from "react-native";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ── Global last-touch memory ─────────────────────────────────
const _lastTouch = { x: SCREEN_W / 2, y: SCREEN_H / 2, t: 0 };

export function getLastTouch() {
  // If the tap is stale (>4s), fall back to screen center so a programmatic
  // open doesn't fly in from a random old coordinate.
  if (Date.now() - _lastTouch.t > 4000) {
    return { x: SCREEN_W / 2, y: SCREEN_H / 2 };
  }
  return { x: _lastTouch.x, y: _lastTouch.y };
}

export function recordTouch(x, y) {
  _lastTouch.x = x;
  _lastTouch.y = y;
  _lastTouch.t = Date.now();
}

/**
 * TouchTracker — wrap your whole app in this. It captures the start of every
 * touch (without consuming it) so we always know the origin of the next modal.
 */
export function TouchTracker({ children, style }) {
  return (
    <View
      style={style ?? { flex: 1 }}
      onStartShouldSetResponderCapture={(e) => {
        const { pageX, pageY } = e.nativeEvent;
        recordTouch(pageX, pageY);
        return false; // never consume — children still get the touch
      }}
    >
      {children}
    </View>
  );
}

// ── OriginPanel — genie-style grow-from-tap ──────────────────
/**
 * Props:
 *   visible    : boolean
 *   onClosed   : called AFTER the close animation finishes (use to unmount)
 *   origin     : optional { x, y }; defaults to getLastTouch()
 *   style      : style for the animated container
 *   children
 *
 * Usage pattern: keep the <Modal> mounted while animating out. Drive `visible`
 * and only set the Modal's own visible=false in onClosed.
 */
export function OriginPanel({ visible, onClosed, origin, style, children, pointerEvents }) {
  const progress = useRef(new Animated.Value(0)).current; // 0 closed, 1 open
  const [layout, setLayout] = useState(null);             // { x, y, w, h } of panel on screen
  const [renderChildren, setRenderChildren] = useState(visible);
  const originRef = useRef(origin || getLastTouch());
  const viewRef = useRef(null);

  // Capture a fresh origin each time we begin opening
  useEffect(() => {
    if (visible) {
      originRef.current = origin || getLastTouch();
      setRenderChildren(true);
    }
  }, [visible]);

  useEffect(() => {
    if (visible) {
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        damping: 18,
        stiffness: 220,
        mass: 0.9,
      }).start();
    } else if (renderChildren) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setRenderChildren(false);
          onClosed?.();
        }
      });
    }
  }, [visible, renderChildren]);

  // Compute translate from panel-center to tap point
  let txFrom = 0, tyFrom = 0;
  if (layout) {
    const panelCx = layout.x + layout.w / 2;
    const panelCy = layout.y + layout.h / 2;
    txFrom = originRef.current.x - panelCx;
    tyFrom = originRef.current.y - panelCy;
  }

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [txFrom, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [tyFrom, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 1] });

  if (!renderChildren) return null;

  return (
    <Animated.View
      ref={viewRef}
      pointerEvents={pointerEvents}
      onLayout={() => {
        // Measure absolute position so the translate math is screen-accurate
        if (viewRef.current?.measureInWindow) {
          viewRef.current.measureInWindow((x, y, w, h) => {
            if (w && h) setLayout({ x, y, w, h });
          });
        }
      }}
      style={[
        style,
        { opacity, transform: [{ translateX }, { translateY }, { scale }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ── Backdrop fade that pairs with OriginPanel ────────────────
export function Backdrop({ visible, children, onPress, color = "rgba(0,0,0,0.5)" }) {
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(o, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 200,
      useNativeDriver: true,
    }).start();
  }, [visible]);
  return (
    <Animated.View style={{ flex: 1, opacity: o }}>
      <Pressable onPress={onPress} style={{ flex: 1, backgroundColor: color }}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ── OriginSheet — drop-in animated modal container ───────────
/**
 * A complete Modal + Backdrop + origin-grow animation in one component.
 * Replaces a hand-rolled <Modal><Pressable backdrop><Pressable card>… pattern.
 *
 * Props:
 *   visible   : boolean (parent state)
 *   onClose   : called when backdrop tapped / dismissed
 *   align     : "bottom" (sheet) | "center" (dialog). Default "bottom".
 *   dark, children
 *   sheetStyle: extra style for the content container
 *   dismissable: if false, backdrop taps don't close (default true)
 */
export function OriginSheet({
  visible, onClose, align = "bottom", children, sheetStyle, dismissable = true,
}) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  if (!mounted) return null;

  const justify = align === "center" ? "center" : "flex-end";

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Backdrop visible={visible} onPress={dismissable ? onClose : undefined}>
        <View style={{ flex: 1, justifyContent: justify }} pointerEvents="box-none">
          <OriginPanel
            visible={visible}
            onClosed={() => setMounted(false)}
            pointerEvents="box-none"
            style={[
              align === "center"
                ? { alignSelf: "center", width: "88%" }
                : { width: "100%" },
              sheetStyle,
            ]}
          >
            {/* stopPropagation so taps inside the card don't dismiss */}
            <Pressable onPress={(e) => e.stopPropagation?.()}>
              {children}
            </Pressable>
          </OriginPanel>
        </View>
      </Backdrop>
    </Modal>
  );
}

// ── Pop — press-to-scale feedback ────────────────────────────
export function Pop({ children, onPress, style, scaleTo = 0.94, disabled, hitSlop, haptic }) {
  const s = useRef(new Animated.Value(1)).current;
  const press = (to) => {
    s.stopAnimation();
    Animated.spring(s, {
      toValue: to,
      useNativeDriver: true,
      damping: 18,
      stiffness: 420,
      overshootClamping: true,
    }).start();
  };
  return (
    <Pressable
      disabled={disabled}
      hitSlop={hitSlop}
      unstable_pressDelay={0}
      android_disableSound={false}
      onPressIn={() => press(scaleTo)}
      onPressOut={() => press(1)}
      onPress={onPress}
      style={[style, { alignItems: "center", justifyContent: "center" }]}
    >
      <Animated.View pointerEvents="none" style={{ transform: [{ scale: s }] }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ── FadeInUp — mount entrance ────────────────────────────────
export function FadeInUp({ children, delay = 0, distance = 14, duration = 360, style }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(p, {
      toValue: 1, duration, delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: p,
      transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

// ── Pulse — infinite gentle breathing ────────────────────────
export function Pulse({ children, style, min = 1, max = 1.06, duration = 1500 }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(p, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(p, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View style={[style, {
      transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [min, max] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

// ── Count-up number animation ────────────────────────────────
export function useCountUp(value, duration = 600) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    if (from === to) return;
    const start = Date.now();
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t >= 1) { clearInterval(id); prev.current = to; setDisplay(to); }
    }, 16);
    return () => clearInterval(id);
  }, [value]);
  return display;
}
