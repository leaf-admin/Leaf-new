package br.com.leaf.ride

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil

/**
 * Corrida em andamento fora do app, para o motorista que navega com o Waze ou o
 * Google Maps em tela cheia:
 *  - balão flutuante por cima de outros apps (Android 8+, permissão "sobrepor");
 *  - Live Update no Android 16 (carro na trilha da notificação e ETA no chip da
 *    barra de status).
 * Os botões abrem o Leaf por deep link (`leafapp://robotaxi/home?rideAction=...`)
 * e o JS executa a ação pelo mesmo caminho das ações da notificação.
 */
class LeafRideOverlayModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "LeafRideOverlay"

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putBoolean("overlaySupported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      putBoolean("canDrawOverlays", canDrawOverlays())
      putBoolean("liveUpdateSupported", LeafRideLiveUpdate.isSupported())
      putInt("sdkInt", Build.VERSION.SDK_INT)
    })
  }

  @ReactMethod
  fun openOverlaySettings(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${reactContext.packageName}")
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("OVERLAY_SETTINGS_UNAVAILABLE", error.message, error)
    }
  }

  @ReactMethod
  fun showOverlay(options: ReadableMap, promise: Promise) {
    if (!canDrawOverlays()) {
      promise.resolve(false)
      return
    }
    val state = LeafRideOverlayState.fromMap(options)
    UiThreadUtil.runOnUiThread {
      try {
        LeafRideOverlayWindow.show(reactContext.applicationContext, state)
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("OVERLAY_SHOW_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun hideOverlay(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      LeafRideOverlayWindow.hide()
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun showLiveUpdate(options: ReadableMap, promise: Promise) {
    if (!LeafRideLiveUpdate.isSupported()) {
      promise.resolve(false)
      return
    }
    try {
      LeafRideLiveUpdate.show(reactContext.applicationContext, LeafRideOverlayState.fromMap(options))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("LIVE_UPDATE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun cancelLiveUpdate(promise: Promise) {
    LeafRideLiveUpdate.cancel(reactContext.applicationContext)
    promise.resolve(true)
  }

  private fun canDrawOverlays(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Settings.canDrawOverlays(reactContext)
}
