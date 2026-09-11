package com.drift.blocker

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.provider.Settings
import android.text.TextUtils
import android.view.accessibility.AccessibilityEvent

/**
 * The fast half of detection.
 *
 * WHAT IT DOES AND DOES NOT DO
 * It reads one field — the package name on a window-change event — and passes
 * it to [BlockerEngine]. It never inspects view trees, text, or content. The
 * service config requests no window content for the same reason: this needs to
 * know *which* app opened, never what is inside it.
 *
 * WHY IT EXISTS WHEN POLLING ALREADY WORKS
 * UsageStats polling reacts in up to a second, which is long enough to read a
 * notification and reply to it before the shield appears. This fires on the
 * transition itself, so the shield lands essentially with the app.
 *
 * PLAY POLICY — READ BEFORE SHIPPING
 * Google restricts AccessibilityService to accessibility purposes, with a
 * carve-out for digital wellbeing and parental controls that blocker apps ship
 * under today. Using it here requires a prominent in-app disclosure before the
 * user is sent to the settings screen, and a declaration in Play Console
 * explaining the use. It is the single most likely part of a submission to
 * draw review questions.
 *
 * It is deliberately OPTIONAL. Everything works without it, just a beat slower,
 * so a rejection or a user who declines costs latency rather than the feature.
 */
class DriftAccessibilityService : AccessibilityService() {

  companion object {
    /**
     * Whether the user has switched this on in Settings.
     *
     * Read from the system's own enabled-services list rather than tracked
     * locally: the user can revoke it at any time from Settings, and Android
     * also disables accessibility services silently on some OEM builds after
     * an update. Anything cached would go stale without warning.
     */
    fun isEnabled(ctx: Context): Boolean {
      val expected = "${ctx.packageName}/${DriftAccessibilityService::class.java.name}"
      val enabled = Settings.Secure.getString(
        ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      ) ?: return false
      val splitter = TextUtils.SimpleStringSplitter(':')
      splitter.setString(enabled)
      while (splitter.hasNext()) {
        if (splitter.next().equals(expected, ignoreCase = true)) return true
      }
      return false
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return
    try {
      BlockerEngine.onForeground(this, pkg)
    } catch (_: Exception) {
      // A throw here would be reported to the user as "Drift has stopped",
      // from a service they cannot see. Never worth it.
    }
  }

  override fun onInterrupt() = Unit
}
