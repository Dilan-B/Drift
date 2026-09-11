package com.drift.blocker

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * The list the user picks from.
 *
 * iOS never needs this — FamilyActivityPicker is a system sheet, and Apple
 * deliberately hides the chosen bundle IDs from the app. Android has no
 * equivalent picker, so Drift has to render its own, which means it first has
 * to enumerate what is installed.
 *
 * Only apps with a LAUNCHER activity are listed: that is the set a user can
 * actually open and therefore the only set worth blocking, and it filters out
 * the hundreds of system packages that would otherwise bury Instagram in
 * noise.
 *
 * Note this queries through the <queries> declaration in the manifest rather
 * than QUERY_ALL_PACKAGES. Since Android 11 the broad permission is treated as
 * sensitive and needs a Play Console justification; the intent filter is the
 * sanctioned way to ask the narrower question and needs none.
 */
object AppLister {

  data class Entry(val packageName: String, val label: String)

  @Suppress("DEPRECATION", "QueryPermissionsNeeded")
  fun installed(ctx: Context): List<Entry> {
    val pm = ctx.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved = try {
      pm.queryIntentActivities(intent, 0)
    } catch (e: Exception) {
      return emptyList()
    }

    return resolved
      .asSequence()
      .mapNotNull { ri ->
        val pkg = ri.activityInfo?.packageName ?: return@mapNotNull null
        // Blocking Drift with Drift would trap the user behind a shield they
        // could no longer get past, since the only way out is to open Drift.
        if (pkg == ctx.packageName) return@mapNotNull null
        val label = try {
          ri.loadLabel(pm)?.toString()
        } catch (e: Exception) {
          null
        } ?: pkg
        Entry(pkg, label)
      }
      // One package can expose several launcher activities; the user thinks in
      // apps, not activities.
      .distinctBy { it.packageName }
      .sortedBy { it.label.lowercase() }
      .toList()
  }

  fun labelFor(ctx: Context, pkg: String): String = try {
    val pm = ctx.packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (e: PackageManager.NameNotFoundException) {
    pkg
  }
}
