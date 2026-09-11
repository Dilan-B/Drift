package com.drift.blocker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/**
 * The always-on half of detection: a foreground service that polls UsageStats.
 *
 * WHY A FOREGROUND SERVICE AND NOT SOMETHING CHEAPER
 * Nothing else survives. A background service is killed within minutes, JobScheduler
 * and WorkManager have a fifteen-minute floor, and alarms are batched — none of
 * which can notice that Instagram opened four seconds ago. A foreground service
 * with an ongoing notification is the only category Android lets run
 * continuously, and the visible notification is the deal: the user can always
 * see that Drift is watching, and can always stop it.
 *
 * WHY IT POLLS EVEN WHEN THE ACCESSIBILITY SERVICE IS ON
 * The accessibility service is faster and cheaper, but it is optional and
 * revocable, and it does not fire while a blocked app simply *stays* open. The
 * poll is what charges the balance second by second during a long session, and
 * what still works for a user who never grants accessibility at all.
 *
 * HONEST LIMITS
 * This is weaker than the iOS shield and always will be. iOS enforces the
 * block in the OS; here a process does, and a process can be force-stopped by
 * the user or killed by an OEM battery manager. It raises the cost of
 * drifting — it does not make it impossible.
 */
class BlockerService : Service() {

  companion object {
    private const val CHANNEL_ID = "drift_blocker_status"
    private const val NOTIF_ID = 4271
    private const val POLL_MS = 1_000L

    @Volatile var isRunning: Boolean = false
      private set

    fun start(ctx: Context) {
      val intent = Intent(ctx, BlockerService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, BlockerService::class.java))
    }
  }

  private val handler = Handler(Looper.getMainLooper())

  /**
   * Last package the poll actually saw.
   *
   * queryEvents returns transitions, so a session longer than the read window
   * yields nothing at all. Treating that emptiness as "no foreground app"
   * would stop charging the balance for exactly the long sittings that matter,
   * so an empty read means "still whatever it was".
   */
  private var lastSeen: String? = null

  private val tick = object : Runnable {
    override fun run() {
      try {
        val pkg = ForegroundAppDetector.currentPackage(this@BlockerService) ?: lastSeen
        if (pkg != null) {
          lastSeen = pkg
          BlockerEngine.onForeground(this@BlockerService, pkg)
        }
      } catch (_: Exception) {
        // Never let a bad tick take the service down; the next one may work.
      }
      handler.postDelayed(this, POLL_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    createChannel()
    startForeground(NOTIF_ID, buildNotification())
    isRunning = true
    handler.post(tick)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // START_STICKY asks Android to recreate the service after it kills us for
    // memory. It is a request, not a guarantee, and OEM battery managers
    // routinely ignore it — hence the reconciliation the JS side does on every
    // foreground.
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    isRunning = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // MIN importance: this notification is a legal requirement for running a
    // foreground service, not something the user should be interrupted by.
    val channel = NotificationChannel(
      CHANNEL_ID, "Blocking status", NotificationManager.IMPORTANCE_MIN
    ).apply {
      description = "Shows while Drift is enforcing your blocked apps."
      setShowBadge(false)
    }
    nm.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = launch?.let {
      PendingIntent.getActivity(
        this, 0, it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }

    return builder
      .setContentTitle("Drift is on")
      .setContentText("Your blocked apps are being held.")
      .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
      .setOngoing(true)
      .apply { pending?.let { setContentIntent(it) } }
      .build()
  }
}
