package com.drift.blocker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Puts the watcher back after a reboot or an app update.
 *
 * Without this there is a silent hole big enough to drive through: the service
 * dies with the device, and nothing restarts it until the user next opens
 * Drift — so the morning after a restart, every blocked app is simply open, and
 * the only signal is the missing notification. A blocker that quietly stops
 * blocking is worse than one that never claimed to.
 *
 * ACTION_MY_PACKAGE_REPLACED matters for the same reason: installing an update
 * force-stops the app and kills the service, and a user who updates Drift
 * should not have to open it again to get blocking back.
 *
 * Starting a foreground service from here is allowed — boot completion is one
 * of the documented exemptions to the background-start restrictions.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_LOCKED_BOOT_COMPLETED -> Unit
      else -> return
    }

    val shouldRun = BlockerPrefs.blockedPackages(ctx).isNotEmpty() &&
      (BlockerPrefs.isShieldActive(ctx) || BlockerPrefs.isMonitoring(ctx))
    if (!shouldRun) return

    // The clock kept running while the device was off. Clearing the tick means
    // the first observation after boot charges nothing, rather than billing the
    // balance for time spent powered down.
    BlockerPrefs.setLastTick(ctx, 0L)

    try {
      BlockerService.start(ctx)
    } catch (_: Exception) {
      // Some OEM builds refuse a foreground start this early in boot. The app
      // reconciles on next launch, so a failure here costs latency, not state.
    }
  }
}
