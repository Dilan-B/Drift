package com.drift.blocker

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for Android app blocking.
 *
 * The surface deliberately mirrors iOS's ScreenTimeModule — applyShield,
 * clearShield, startBalanceMonitoring, consumeUsedSeconds, consumeDepletedFlag,
 * setAppearance — so `screenTime.js` can dispatch by platform without any
 * caller learning that the two work nothing alike underneath.
 *
 * The extra functions are the ones Android forces into the open: iOS asks for
 * a single Family Controls authorization, whereas here the user must grant
 * usage access and overlay permission in two separate Settings screens, and
 * optionally a third for accessibility.
 */
class DriftBlockerModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("DriftBlocker")

    // ── Capability + permissions ───────────────────────────────
    AsyncFunction("getStatus") {
      val usage = ForegroundAppDetector.hasUsageAccess(context)
      val overlay = BlockerEngine.canShowShield(context)
      mapOf(
        "usageAccess" to usage,
        "overlay" to overlay,
        "accessibility" to DriftAccessibilityService.isEnabled(context),
        // Blocking needs BOTH: usage access to notice the app, overlay to put
        // anything in front of it. Either one missing makes the feature a
        // no-op, so onboarding must not report success until both are on.
        "ready" to (usage && overlay),
        "serviceRunning" to BlockerService.isRunning,
        "shieldActive" to BlockerPrefs.isShieldActive(context),
        "monitoring" to BlockerPrefs.isMonitoring(context),
        "balanceSeconds" to (BlockerPrefs.balanceMs(context) / 1000.0),
        "blockedCount" to BlockerPrefs.blockedPackages(context).size
      )
    }

    AsyncFunction("openUsageAccessSettings") {
      // No dialog exists for this one; the user has to be walked to Settings.
      // The package-scoped URI puts Drift at the top on most builds, but some
      // OEMs ignore it and open the bare list, which is why the in-app copy
      // has to name what to look for rather than say "tap the toggle".
      open(Settings.ACTION_USAGE_ACCESS_SETTINGS, scoped = true)
    }

    AsyncFunction("openOverlaySettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        open(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, scoped = true)
      }
    }

    AsyncFunction("openAccessibilitySettings") {
      open(Settings.ACTION_ACCESSIBILITY_SETTINGS, scoped = false)
    }

    // ── Choosing apps ──────────────────────────────────────────
    AsyncFunction("getInstalledApps") {
      AppLister.installed(context).map {
        mapOf("packageName" to it.packageName, "label" to it.label)
      }
    }

    AsyncFunction("getBlockedApps") {
      BlockerPrefs.blockedPackages(context).map {
        mapOf("packageName" to it, "label" to AppLister.labelFor(context, it))
      }
    }

    AsyncFunction("setBlockedApps") { packages: List<String> ->
      BlockerPrefs.setBlockedPackages(context, packages.toSet())
      syncService()
      packages.size
    }

    // ── Enforcement ────────────────────────────────────────────
    AsyncFunction("applyShield") {
      BlockerPrefs.setShieldActive(context, true)
      BlockerPrefs.setMonitoring(context, false)
      syncService()
      true
    }

    AsyncFunction("clearShield") {
      BlockerPrefs.setShieldActive(context, false)
      syncService()
      true
    }

    /**
     * Allow `seconds` more of blocked-app use before the shield goes up.
     *
     * The countdown is spent only while a blocked app is actually in front, so
     * this is a budget rather than a timer — closing the app pauses it, exactly
     * as the DeviceActivity threshold does on iOS.
     */
    AsyncFunction("startBalanceMonitoring") { seconds: Double ->
      BlockerPrefs.setBalanceMs(context, (seconds * 1000).toLong())
      BlockerPrefs.setMonitoring(context, true)
      BlockerPrefs.setShieldActive(context, false)
      BlockerPrefs.setLastTick(context, 0L)
      syncService()
      true
    }

    AsyncFunction("stopBalanceMonitoring") {
      BlockerPrefs.setMonitoring(context, false)
      syncService()
      true
    }

    AsyncFunction("consumeUsedSeconds") { BlockerPrefs.consumeUsedSeconds(context) }

    AsyncFunction("consumeDepletedFlag") { BlockerPrefs.consumeDepleted(context) }

    AsyncFunction("setAppearance") { dark: Boolean ->
      BlockerPrefs.setDark(context, dark)
      true
    }

    AsyncFunction("getDiagnostics") {
      mapOf(
        // Named for iOS's diagnostics payload on purpose. blockedApps.js reads
        // `pickedAppCount` to decide whether anything is selected, and that one
        // shared field lets getBlockedSelectionCount() and applyBlocking() work
        // on both platforms without a single branch in the JS.
        "pickedAppCount" to BlockerPrefs.blockedPackages(context).size,
        "pickedCategoryCount" to 0,
        "pickedWebCount" to 0,
        "usageAccess" to ForegroundAppDetector.hasUsageAccess(context),
        "overlay" to BlockerEngine.canShowShield(context),
        "accessibility" to DriftAccessibilityService.isEnabled(context),
        "serviceRunning" to BlockerService.isRunning,
        "shieldActive" to BlockerPrefs.isShieldActive(context),
        "monitoring" to BlockerPrefs.isMonitoring(context),
        "balanceMs" to BlockerPrefs.balanceMs(context),
        "usedMs" to BlockerPrefs.usedMs(context),
        "blocked" to BlockerPrefs.blockedPackages(context).toList(),
        "foreground" to ForegroundAppDetector.currentPackage(context),
        "sdk" to Build.VERSION.SDK_INT
      )
    }
  }

  /**
   * Run the watcher exactly when there is something to watch.
   *
   * The service carries a permanent notification, so leaving it running with
   * nothing blocked is a visible cost to the user for no benefit — and leaving
   * it stopped while a shield is meant to be up silently breaks the feature.
   */
  private fun syncService() {
    val ctx = context
    val shouldRun = BlockerPrefs.blockedPackages(ctx).isNotEmpty() &&
      (BlockerPrefs.isShieldActive(ctx) || BlockerPrefs.isMonitoring(ctx))
    if (shouldRun) BlockerService.start(ctx) else BlockerService.stop(ctx)
  }

  private fun open(action: String, scoped: Boolean) {
    val intent = Intent(action).apply {
      if (scoped) data = Uri.parse("package:${context.packageName}")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      // Some OEM builds reject the package-scoped form. Falling back to the
      // plain list is worse UX but still gets the user somewhere they can
      // finish the job, which beats a button that appears to do nothing.
      try {
        context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (_: Exception) {
      }
    }
  }
}
