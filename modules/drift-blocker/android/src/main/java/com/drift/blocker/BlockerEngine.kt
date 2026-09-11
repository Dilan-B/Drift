package com.drift.blocker

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log

/**
 * The actual blocking decision, in one place.
 *
 * Two very different detectors feed this — a 1Hz poll over UsageStats and an
 * accessibility service that fires on window changes — and they must not
 * disagree about what happens when a blocked app appears. Both call
 * [onForeground] and neither knows any of the rules.
 */
object BlockerEngine {
  private const val TAG = "DriftBlocker"

  /**
   * Longest gap a single tick may charge against the balance.
   *
   * Elapsed time is measured between observations, and observations stop
   * whenever the OS freezes the service, the screen locks, or an OEM battery
   * manager decides to intervene. Without this clamp the first tick after a
   * six-hour sleep would bill six hours and wipe the balance for time nobody
   * spent in the app. Capping it means the accounting can undercount a little;
   * that is the correct direction to be wrong in.
   */
  private const val MAX_TICK_MS = 5_000L

  fun onForeground(ctx: Context, pkg: String?) {
    if (pkg.isNullOrEmpty()) return

    val now = System.currentTimeMillis()
    val last = BlockerPrefs.lastTick(ctx)
    BlockerPrefs.setLastTick(ctx, now)

    // Our own UI is never blocked — including the shield itself, which would
    // otherwise re-trigger against its own foreground event forever.
    if (pkg == ctx.packageName) return
    if (pkg !in BlockerPrefs.blockedPackages(ctx)) return

    if (BlockerPrefs.isShieldActive(ctx)) {
      showShield(ctx)
      return
    }

    if (!BlockerPrefs.isMonitoring(ctx)) return

    // `last == 0` is the first observation after a restart: we genuinely do not
    // know how long this app has been open, so charge nothing.
    val elapsed = if (last == 0L) 0L else (now - last).coerceIn(0L, MAX_TICK_MS)
    if (elapsed <= 0L) return

    BlockerPrefs.addUsedMs(ctx, elapsed)
    val remaining = BlockerPrefs.balanceMs(ctx) - elapsed

    if (remaining <= 0L) {
      BlockerPrefs.setBalanceMs(ctx, 0L)
      BlockerPrefs.setMonitoring(ctx, false)
      BlockerPrefs.setShieldActive(ctx, true)
      // Consumed by JS on next foreground, so the app can tell the user their
      // time ran out while Drift was closed. Mirrors the iOS depleted flag.
      BlockerPrefs.setDepleted(ctx, true)
      Log.i(TAG, "balance depleted, shield up")
      showShield(ctx)
    } else {
      BlockerPrefs.setBalanceMs(ctx, remaining)
    }
  }

  /**
   * Put the shield in front of whatever is showing.
   *
   * Since Android 10 an app cannot simply start an activity from the
   * background — the start is silently dropped, with only a logcat line to say
   * so. The documented exception, and the one every blocker relies on, is
   * holding SYSTEM_ALERT_WINDOW ("Display over other apps"). That is why the
   * permission is required rather than merely nice to have, and why
   * [canShowShield] gates the whole feature.
   */
  fun showShield(ctx: Context) {
    if (!canShowShield(ctx)) {
      Log.w(TAG, "cannot show shield: overlay permission missing")
      return
    }
    val intent = Intent(ctx, ShieldActivity::class.java).apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_NO_ANIMATION
      )
    }
    try {
      ctx.startActivity(intent)
    } catch (e: Exception) {
      Log.e(TAG, "failed to start shield", e)
    }
  }

  fun canShowShield(ctx: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(ctx) else true
}
