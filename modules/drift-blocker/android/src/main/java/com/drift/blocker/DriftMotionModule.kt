package com.drift.blocker

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Lockbox motion sensing for Android — a faithful port of iOS's LockboxModule.
 *
 * WHY THIS HAD TO EXIST
 * Without it, Lockbox on Android was free screen time. `startMonitoring` threw
 * "unavailable" and every call site swallowed it, `onStateChange` returned a
 * no-op, so `markDisturbed()` could never fire — and that is the ONLY route to
 * forfeiting a session. Every session therefore ran to `settle("completed")`
 * and paid out in full, whether or not the phone ever went in the box. In an
 * app whose entire premise is earning screen time honestly, that is the worst
 * kind of bug: silent, and in the user's favour.
 *
 * THE CONSTANTS ARE iOS's, DELIBERATELY
 * threshold, streak lengths and the flat cutoff are copied from
 * LockboxModule.swift rather than re-tuned, so a session behaves the same on
 * both platforms and GRACE_SECONDS means the same thing to both. If these are
 * ever tuned, tune them together.
 *
 * ONE REAL DIFFERENCE: THE SIGN OF GRAVITY Z
 * Both platforms put the z-axis out through the screen, but they disagree on
 * the sign. iOS reads gravity.z ≈ -1 with the screen up; Android reads
 * +9.81 m/s². So iOS tests `gravity.z < -flatThreshold` for face-up and
 * Android must test `> +flatThreshold`. Copying the iOS comparison verbatim
 * would invert face-up and face-down and break entry detection, since the
 * phone goes in screen UP.
 */
class DriftMotionModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val sensorManager: SensorManager?
    get() = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager

  // ── iOS's constants ────────────────────────────────────────
  private val baseThreshold = 0.08   // G, gravity-free
  private val disturbSamples = 3     // react fast to movement
  private val settleSamples = 20     // and slowly to stillness
  private val flatThreshold = 0.8    // |gravity z|, normalised to G
  private val samplingPeriodUs = 50_000  // 20 Hz, matching iOS

  private val gravityMs2 = 9.80665

  private var threshold = baseThreshold
  private var disturbStreak = 0
  private var settleStreak = 0
  private var isDisturbed = false
  private var isFlat = false
  private var isFaceUp = false
  private var monitoring = false

  private var lastMagnitude = 0.0
  private var lastGravityZ = 0.0

  /**
   * Latest raw accelerometer sample, used only by the fallback path.
   * TYPE_LINEAR_ACCELERATION and TYPE_GRAVITY are "composite" sensors the OS
   * synthesises; most devices have them, cheap ones sometimes do not. When they
   * are missing we split a plain accelerometer feed ourselves with a low-pass
   * filter — the same trick the platform uses internally.
   */
  private val gravityFilter = DoubleArray(3)
  private var filterPrimed = false
  private var usingFallback = false

  private val listener = object : SensorEventListener {
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onSensorChanged(event: SensorEvent?) {
      event ?: return
      when (event.sensor.type) {
        Sensor.TYPE_LINEAR_ACCELERATION -> {
          val g = magnitudeG(event.values)
          handleSample(g, lastGravityZ)
        }
        Sensor.TYPE_GRAVITY -> {
          lastGravityZ = event.values[2] / gravityMs2
          handleSample(lastMagnitude, lastGravityZ)
        }
        Sensor.TYPE_ACCELEROMETER -> {
          // Fallback: alpha 0.8 isolates the slow-moving gravity component,
          // and whatever is left is the movement we care about.
          val alpha = 0.8
          for (i in 0..2) {
            gravityFilter[i] = if (!filterPrimed) event.values[i].toDouble()
            else alpha * gravityFilter[i] + (1 - alpha) * event.values[i]
          }
          filterPrimed = true
          val linear = DoubleArray(3) { event.values[it] - gravityFilter[it] }
          val g = sqrt(linear[0] * linear[0] + linear[1] * linear[1] + linear[2] * linear[2]) / gravityMs2
          lastGravityZ = gravityFilter[2] / gravityMs2
          handleSample(g, lastGravityZ)
        }
      }
    }
  }

  private fun magnitudeG(v: FloatArray): Double {
    val m = sqrt((v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).toDouble()) / gravityMs2
    lastMagnitude = m
    return m
  }

  /** Straight transcription of iOS's handle(sample:). */
  private fun handleSample(mag: Double, gz: Double) {
    if (!monitoring) return

    // Android's +z is iOS's -z; see the class comment.
    val flatNow = abs(gz) > flatThreshold
    val faceUpNow = gz > flatThreshold
    if (flatNow != isFlat || faceUpNow != isFaceUp) {
      isFlat = flatNow
      isFaceUp = faceUpNow
      emit(if (isDisturbed) "disturbed" else "settled", mag)
    }

    if (mag > threshold) {
      disturbStreak += 1
      settleStreak = 0
      if (!isDisturbed && disturbStreak >= disturbSamples) {
        isDisturbed = true
        emit("disturbed", mag)
      }
    } else {
      settleStreak += 1
      disturbStreak = 0
      if (isDisturbed && settleStreak >= settleSamples) {
        isDisturbed = false
        emit("settled", mag)
      }
    }
  }

  private fun emit(state: String, magnitude: Double) {
    sendEvent(
      "LockboxState",
      mapOf(
        "state" to state,
        "magnitude" to magnitude,
        "flat" to isFlat,
        "faceUp" to isFaceUp,
        "threshold" to threshold
      )
    )
  }

  override fun definition() = ModuleDefinition {
    Name("DriftMotion")

    Events("LockboxState")

    Function("isAvailable") {
      val sm = sensorManager ?: return@Function false
      sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
    }

    AsyncFunction("startMonitoring") { sensitivity: Double ->
      val sm = sensorManager ?: throw Exceptions.ReactContextLost()
      stopInternal()

      val scale = sensitivity.coerceIn(0.2, 3.0)
      threshold = baseThreshold * scale

      // Start pessimistic, exactly as iOS does: a phone is not considered
      // settled until it has earned a full settle streak. Otherwise the first
      // sample after Start would declare an in-hand phone "settled".
      isDisturbed = true
      disturbStreak = 0
      settleStreak = 0
      isFlat = false
      isFaceUp = false
      filterPrimed = false

      val linear = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
      val gravity = sm.getDefaultSensor(Sensor.TYPE_GRAVITY)
      usingFallback = linear == null || gravity == null

      if (!usingFallback) {
        sm.registerListener(listener, linear, samplingPeriodUs)
        sm.registerListener(listener, gravity, samplingPeriodUs)
      } else {
        val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
          ?: throw Exceptions.ReactContextLost()
        sm.registerListener(listener, accel, samplingPeriodUs)
      }

      monitoring = true
      mapOf("monitoring" to true, "threshold" to threshold, "fallback" to usingFallback)
    }

    AsyncFunction("stopMonitoring") {
      stopInternal()
      true
    }

    /** Instantaneous reading, for the "hold still" meter during placement. */
    AsyncFunction("currentMagnitude") { if (monitoring) lastMagnitude else 0.0 }

    AsyncFunction("getState") {
      mapOf(
        "monitoring" to monitoring,
        "magnitude" to lastMagnitude,
        "gravityZ" to lastGravityZ,
        "flat" to isFlat,
        "faceUp" to isFaceUp,
        "settled" to !isDisturbed,
        "threshold" to threshold,
        "fallback" to usingFallback
      )
    }

    OnDestroy { stopInternal() }
  }

  private fun stopInternal() {
    if (!monitoring) return
    monitoring = false
    try { sensorManager?.unregisterListener(listener) } catch (_: Exception) {}
  }
}
