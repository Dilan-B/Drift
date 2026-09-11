package com.drift.blocker

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process

/**
 * "Which app is the user looking at right now?"
 *
 * Android deliberately makes this hard. getRunningTasks was removed in
 * Lollipop, so the only route left for a normal app is UsageStatsManager,
 * behind PACKAGE_USAGE_STATS — a permission that cannot be requested with a
 * dialog. The user has to toggle it in a system Settings screen, which is why
 * onboarding has to walk them there.
 */
object ForegroundAppDetector {

  /**
   * Events are read over a wide window rather than the last second.
   *
   * The stream only contains *transitions*, so an app opened twenty minutes
   * ago and never left emits nothing recent — a narrow window would report "no
   * foreground app" for exactly the case this feature exists to catch. Reading
   * a wide span and keeping the newest resume is what makes a long sitting
   * session visible. Callers still cache, for sessions longer than this.
   */
  private const val WINDOW_MS = 60_000L

  @Suppress("DEPRECATION")
  fun currentPackage(ctx: Context): String? {
    if (!hasUsageAccess(ctx)) return null
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
    val end = System.currentTimeMillis()
    val events = try {
      usm.queryEvents(end - WINDOW_MS, end)
    } catch (e: Exception) {
      return null
    }

    var latest: String? = null
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      // ACTIVITY_RESUMED (API 29+) and MOVE_TO_FOREGROUND are the same
      // constant, 1 — the name changed, the value did not. Comparing the
      // deprecated name keeps one code path for every supported API level.
      if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
        latest = event.packageName
      }
    }
    return latest
  }

  /**
   * Whether PACKAGE_USAGE_STATS has been granted.
   *
   * There is no checkSelfPermission for this one — it is an "app op", not a
   * runtime permission, so it has to be read through AppOpsManager. Calling
   * queryEvents without it does not throw either; it quietly returns an empty
   * stream, which would look exactly like "the user is on the home screen".
   */
  fun hasUsageAccess(ctx: Context): Boolean {
    val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName
      )
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName
      )
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }
}
