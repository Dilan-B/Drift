package com.drift.blocker

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The block screen — Android's answer to the iOS shield.
 *
 * WHY IT IS AN ACTIVITY RATHER THAN A FLOATING OVERLAY
 * A TYPE_APPLICATION_OVERLAY window would sit on top of the blocked app while
 * the app keeps running underneath: still playing video, still autoplaying the
 * feed, and still one stray tap away. A full activity actually takes the
 * foreground, so the blocked app is paused by the OS the same way any app
 * switch pauses it.
 *
 * WHY BACK GOES HOME
 * Finishing this activity would hand the user straight back to the app they
 * were just blocked from, which makes the block a single tap of theatre. Back
 * goes to the launcher instead. There is no dismiss for the same reason the
 * iOS shield has none.
 *
 * The palette is duplicated from theme.js rather than imported because this
 * screen has to render with no React context alive at all — it is frequently
 * the first thing drawn after the OS restarts the process.
 */
class ShieldActivity : Activity() {

  private object Palette {
    val darkBg = Color.parseColor("#050706")
    val darkInk = Color.parseColor("#F0F7EA")
    val darkMuted = Color.parseColor("#A9C4AB")
    val darkAccent = Color.parseColor("#C6F2A0")
    val darkAccentInk = Color.parseColor("#0B1A11")

    val lightBg = Color.parseColor("#F7F7F4")
    val lightInk = Color.parseColor("#1A2820")
    val lightMuted = Color.parseColor("#6B7A6E")
    val lightAccent = Color.parseColor("#3A6B4F")
    val lightAccentInk = Color.WHITE
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Keep showing over the lock screen and turn the display on — the block
    // has to be what the user sees, not something waiting behind a lock.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }

    setContentView(buildView())
  }

  /**
   * Re-check on every resume.
   *
   * The user can earn time in Drift while this is sitting in the back stack.
   * Without this they would come back to a stale block screen and have to
   * guess that it no longer applied.
   */
  override fun onResume() {
    super.onResume()
    if (!BlockerPrefs.isShieldActive(this)) finish()
  }

  @Suppress("DEPRECATION", "MissingSuperCall")
  override fun onBackPressed() {
    goHome()
  }

  private fun goHome() {
    startActivity(Intent(Intent.ACTION_MAIN).apply {
      addCategory(Intent.CATEGORY_HOME)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK
    })
    finish()
  }

  private fun dp(v: Int): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
  ).toInt()

  private fun buildView(): View {
    val dark = BlockerPrefs.isDark(this)
    val bg = if (dark) Palette.darkBg else Palette.lightBg
    val ink = if (dark) Palette.darkInk else Palette.lightInk
    val muted = if (dark) Palette.darkMuted else Palette.lightMuted
    val accent = if (dark) Palette.darkAccent else Palette.lightAccent
    val accentInk = if (dark) Palette.darkAccentInk else Palette.lightAccentInk

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(bg)
      setPadding(dp(32), dp(32), dp(32), dp(32))
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
      )
    }

    root.addView(TextView(this).apply {
      text = "Out of time"
      setTextColor(ink)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
      gravity = Gravity.CENTER
    })

    root.addView(TextView(this).apply {
      text = "This app is blocked until you earn more screen time."
      setTextColor(muted)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      gravity = Gravity.CENTER
      setPadding(0, dp(12), 0, dp(32))
    })

    root.addView(Button(this).apply {
      text = "Earn time in Drift"
      setTextColor(accentInk)
      isAllCaps = false
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      background = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(accent)
      }
      setPadding(dp(24), dp(14), dp(24), dp(14))
      setOnClickListener {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        if (launch != null) {
          launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          startActivity(launch)
        }
        finish()
      }
    })

    root.addView(Button(this).apply {
      text = "Close"
      setTextColor(muted)
      isAllCaps = false
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      background = null
      setPadding(0, dp(18), 0, 0)
      // Goes to the launcher, not back to the blocked app. "Close" means
      // leave, and there is no route from here that ends in the feed.
      setOnClickListener { goHome() }
    })

    return root
  }
}
