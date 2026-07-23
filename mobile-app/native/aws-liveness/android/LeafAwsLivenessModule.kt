package br.com.leaf.ride

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.lang.ref.WeakReference

object LeafAwsLivenessPromiseRegistry {
  private val lock = Any()
  private var pendingPromise: Promise? = null
  private var pendingSessionId: String? = null
  private var activeActivity: WeakReference<LeafAwsLivenessActivity>? = null

  fun register(sessionId: String, promise: Promise): Boolean = synchronized(lock) {
    if (pendingPromise != null) {
      return@synchronized false
    }

    pendingPromise = promise
    pendingSessionId = sessionId
    activeActivity = null
    true
  }

  fun attach(activity: LeafAwsLivenessActivity, sessionId: String): Boolean = synchronized(lock) {
    if (pendingPromise == null || pendingSessionId != sessionId) {
      return@synchronized false
    }

    activeActivity = WeakReference(activity)
    true
  }

  fun detach(activity: LeafAwsLivenessActivity) {
    synchronized(lock) {
      if (activeActivity?.get() === activity) {
        activeActivity = null
      }
    }
  }

  fun resolve(sessionId: String): Boolean {
    val payload = Arguments.createMap().apply {
      putBoolean("success", true)
      putString("sessionId", sessionId)
    }

    val promise = takePromise(sessionId) ?: return false
    promise.resolve(payload)
    return true
  }

  fun reject(
    sessionId: String,
    code: String,
    message: String,
    throwable: Throwable? = null
  ): Boolean {
    val promise = takePromise(sessionId) ?: return false
    promise.reject(code, message, throwable)
    return true
  }

  fun cancel(): Boolean {
    val target = synchronized(lock) {
      val promise = pendingPromise
      val activity = activeActivity?.get()
      pendingPromise = null
      pendingSessionId = null
      activeActivity = null
      Pair(promise, activity)
    }

    target.first?.reject(
      "AWS_LIVENESS_CANCELLED",
      "A validação facial foi encerrada."
    )
    target.second?.finishFromBridge()
    return target.first != null || target.second != null
  }

  private fun takePromise(sessionId: String): Promise? = synchronized(lock) {
    if (pendingSessionId != sessionId) {
      return@synchronized null
    }

    val promise = pendingPromise
    pendingPromise = null
    pendingSessionId = null
    promise
  }
}

class LeafAwsLivenessModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "LeafAwsLiveness"

  @ReactMethod
  fun start(options: ReadableMap, promise: Promise) {
    val sessionId = options.getString("sessionId")
    val region = options.getString("region")
    val credentials = if (options.hasKey("credentials")) options.getMap("credentials") else null
    val accessKeyId = credentials?.getString("accessKeyId")
    val secretAccessKey = credentials?.getString("secretAccessKey")
    val sessionToken = credentials?.getString("sessionToken")
    val expiration = credentials?.getString("expiration")

    if (
      sessionId.isNullOrBlank()
      || region.isNullOrBlank()
      || accessKeyId.isNullOrBlank()
      || secretAccessKey.isNullOrBlank()
      || sessionToken.isNullOrBlank()
    ) {
      promise.reject("AWS_LIVENESS_INVALID_OPTIONS", "Sessão ou credenciais AWS inválidas.")
      return
    }

    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("AWS_LIVENESS_NO_ACTIVITY", "Não foi possível abrir a validação facial.")
      return
    }

    if (!LeafAwsLivenessPromiseRegistry.register(sessionId, promise)) {
      promise.reject("AWS_LIVENESS_ALREADY_RUNNING", "Uma validação facial já está em andamento.")
      return
    }

    val intent = Intent(activity, LeafAwsLivenessActivity::class.java).apply {
      putExtra(LeafAwsLivenessActivity.EXTRA_SESSION_ID, sessionId)
      putExtra(LeafAwsLivenessActivity.EXTRA_REGION, region)
      putExtra(LeafAwsLivenessActivity.EXTRA_ACCESS_KEY_ID, accessKeyId)
      putExtra(LeafAwsLivenessActivity.EXTRA_SECRET_ACCESS_KEY, secretAccessKey)
      putExtra(LeafAwsLivenessActivity.EXTRA_SESSION_TOKEN, sessionToken)
      putExtra(LeafAwsLivenessActivity.EXTRA_EXPIRATION, expiration)
    }

    try {
      activity.startActivity(intent)
    } catch (error: Exception) {
      LeafAwsLivenessPromiseRegistry.reject(
        sessionId,
        "AWS_LIVENESS_OPEN_FAILED",
        "Não foi possível abrir a validação facial.",
        error
      )
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    val payload = Arguments.createMap().apply {
      putBoolean("success", true)
      putBoolean("cancelled", LeafAwsLivenessPromiseRegistry.cancel())
    }
    promise.resolve(payload)
  }

  override fun invalidate() {
    LeafAwsLivenessPromiseRegistry.cancel()
    super.invalidate()
  }
}
