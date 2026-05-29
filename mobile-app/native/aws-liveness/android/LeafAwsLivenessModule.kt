package br.com.leaf.ride

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

object LeafAwsLivenessPromiseRegistry {
  var pendingPromise: Promise? = null

  fun resolve(sessionId: String) {
    val payload = Arguments.createMap().apply {
      putBoolean("success", true)
      putString("sessionId", sessionId)
    }
    pendingPromise?.resolve(payload)
    pendingPromise = null
  }

  fun reject(code: String, message: String, throwable: Throwable? = null) {
    pendingPromise?.reject(code, message, throwable)
    pendingPromise = null
  }
}

class LeafAwsLivenessModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "LeafAwsLiveness"

  @ReactMethod
  fun start(options: ReadableMap, promise: Promise) {
    if (LeafAwsLivenessPromiseRegistry.pendingPromise != null) {
      promise.reject("AWS_LIVENESS_ALREADY_RUNNING", "Uma validação facial já está em andamento.")
      return
    }

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

    LeafAwsLivenessPromiseRegistry.pendingPromise = promise

    val intent = Intent(activity, LeafAwsLivenessActivity::class.java).apply {
      putExtra(LeafAwsLivenessActivity.EXTRA_SESSION_ID, sessionId)
      putExtra(LeafAwsLivenessActivity.EXTRA_REGION, region)
      putExtra(LeafAwsLivenessActivity.EXTRA_ACCESS_KEY_ID, accessKeyId)
      putExtra(LeafAwsLivenessActivity.EXTRA_SECRET_ACCESS_KEY, secretAccessKey)
      putExtra(LeafAwsLivenessActivity.EXTRA_SESSION_TOKEN, sessionToken)
      putExtra(LeafAwsLivenessActivity.EXTRA_EXPIRATION, expiration)
    }
    activity.startActivity(intent)
  }
}
