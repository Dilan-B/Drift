package com.drift.blocker

import android.content.Context
import android.content.SharedPreferences

/**
 * The single source of truth for blocking state.
 *
 * Four separate processes-in-one read this: the Expo module (JS calls), the
 * polling service, the accessibility service, and the shield screen. They do
 * not share memory in any reliable way — the service can be killed and
 * restarted by the OS at any time, and on Android 14 the accessibility service
 * lives in a different lifecycle entirely — so every piece of state that
 * matters has to survive a process death. SharedPreferences is the only thing
 * here that does.
 *
 * MIRRORS iOS ON PURPOSE. The iOS side keeps the same shape in App Group
 * storage so the DeviceActivity extension can reach it, and `screenTime.js`
 * already speaks this vocabulary — shield on/off, a balance counted down by
 * usage, a "seconds used" counter the app drains on foreground, and a
 * depleted flag that fires once. Matching it exactly is what lets the JS layer
 * treat the two platforms identically.
 */
object BlockerPrefs {
  private const val FILE = "drift_blocker"

  private const val K_BLOCKED = "blocked_packages"
  private const val K_SHIELD = "shield_active"
  private const val K_BALANCE_MS = "balance_ms"
  private const val K_MONITORING = "monitoring"
  private const val K_USED_MS = "used_ms"
  private const val K_DEPLETED = "depleted"
  private const val K_DARK = "dark"
  private const val K_LAST_TICK = "last_tick"

  fun prefs(ctx: Context): SharedPreferences =
    ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  // ── What to block ──────────────────────────────────────────
  fun blockedPackages(ctx: Context): Set<String> =
    prefs(ctx).getStringSet(K_BLOCKED, emptySet()) ?: emptySet()

  fun setBlockedPackages(ctx: Context, packages: Set<String>) {
    // A fresh HashSet is deliberate. SharedPreferences hands back a live set
    // whose mutation is explicitly undefined, and writing the same instance
    // back is a documented way to lose the change entirely.
    prefs(ctx).edit().putStringSet(K_BLOCKED, HashSet(packages)).apply()
  }

  // ── Shield ─────────────────────────────────────────────────
  fun isShieldActive(ctx: Context): Boolean = prefs(ctx).getBoolean(K_SHIELD, false)

  fun setShieldActive(ctx: Context, active: Boolean) {
    prefs(ctx).edit().putBoolean(K_SHIELD, active).apply()
  }

  // ── Balance ────────────────────────────────────────────────
  /**
   * Milliseconds of blocked-app use still allowed. Held in millis rather than
   * seconds because the detector ticks faster than 1Hz; rounding every tick to
   * whole seconds would let someone bleed the balance far slower than real
   * time, or not at all.
   */
  fun balanceMs(ctx: Context): Long = prefs(ctx).getLong(K_BALANCE_MS, 0L)

  fun setBalanceMs(ctx: Context, ms: Long) {
    prefs(ctx).edit().putLong(K_BALANCE_MS, ms.coerceAtLeast(0L)).apply()
  }

  fun isMonitoring(ctx: Context): Boolean = prefs(ctx).getBoolean(K_MONITORING, false)

  fun setMonitoring(ctx: Context, on: Boolean) {
    prefs(ctx).edit().putBoolean(K_MONITORING, on).apply()
  }

  /** Wall-clock of the last accounting tick, so elapsed time can be measured. */
  fun lastTick(ctx: Context): Long = prefs(ctx).getLong(K_LAST_TICK, 0L)

  fun setLastTick(ctx: Context, at: Long) {
    prefs(ctx).edit().putLong(K_LAST_TICK, at).apply()
  }

  // ── Reporting back to JS ───────────────────────────────────
  fun addUsedMs(ctx: Context, ms: Long) {
    prefs(ctx).edit().putLong(K_USED_MS, usedMs(ctx) + ms).apply()
  }

  fun usedMs(ctx: Context): Long = prefs(ctx).getLong(K_USED_MS, 0L)

  /** Read-and-clear, matching iOS's consumeUsedSeconds(). */
  fun consumeUsedSeconds(ctx: Context): Double {
    val ms = usedMs(ctx)
    prefs(ctx).edit().putLong(K_USED_MS, 0L).apply()
    return ms / 1000.0
  }

  fun setDepleted(ctx: Context, v: Boolean) {
    prefs(ctx).edit().putBoolean(K_DEPLETED, v).apply()
  }

  /** Read-and-clear, matching iOS's consumeDepletedFlag(). */
  fun consumeDepleted(ctx: Context): Boolean {
    val v = prefs(ctx).getBoolean(K_DEPLETED, false)
    if (v) prefs(ctx).edit().putBoolean(K_DEPLETED, false).apply()
    return v
  }

  // ── Appearance ─────────────────────────────────────────────
  fun isDark(ctx: Context): Boolean = prefs(ctx).getBoolean(K_DARK, false)

  fun setDark(ctx: Context, dark: Boolean) {
    prefs(ctx).edit().putBoolean(K_DARK, dark).apply()
  }
}
