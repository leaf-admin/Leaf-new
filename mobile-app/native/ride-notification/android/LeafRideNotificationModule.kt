package br.com.leaf.ride

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class LeafRideNotificationModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "LeafRideNotification"

  companion object {
    private const val DEFAULT_CHANNEL_ID = "ride_status"
    private const val CHANNEL_NAME = "Status da Corrida"
    private const val CHANNEL_DESCRIPTION = "Atualizações persistentes da corrida em andamento"
    private const val NOTIFICATION_ID = 43001
    private const val NATIVE_NOTIFICATION_ID = "leaf-ride-status-43001"
  }

  private fun hasNotificationPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
    return ContextCompat.checkSelfPermission(
      reactContext,
      Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun ensureChannel(channelId: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val existing = manager.getNotificationChannel(channelId)
    if (existing != null) return

    val channel = NotificationChannel(
      channelId,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = CHANNEL_DESCRIPTION
      enableVibration(false)
      setSound(null, null)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun createContentIntent(bookingId: String?, status: String?): PendingIntent {
    val launchIntent = reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)
      ?: Intent(reactContext, MainActivity::class.java)

    launchIntent.apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra("leafNotificationType", "ride_status")
      putExtra("bookingId", bookingId)
      putExtra("status", status)
    }

    return PendingIntent.getActivity(
      reactContext,
      NOTIFICATION_ID,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  @ReactMethod
  fun showOrUpdate(options: ReadableMap, promise: Promise) {
    try {
      if (!hasNotificationPermission()) {
        val payload = Arguments.createMap().apply {
          putBoolean("success", false)
          putString("reason", "POST_NOTIFICATIONS_NOT_GRANTED")
          putString("notificationId", NATIVE_NOTIFICATION_ID)
        }
        promise.resolve(payload)
        return
      }

      val channelId = (if (options.hasKey("channelId")) options.getString("channelId") else null) ?: DEFAULT_CHANNEL_ID
      ensureChannel(channelId)

      val title = (if (options.hasKey("title")) options.getString("title") else null) ?: "Corrida ativa"
      val body = (if (options.hasKey("body")) options.getString("body") else null) ?: "Acompanhe o status da corrida"
      val bookingId = if (options.hasKey("bookingId")) options.getString("bookingId") else null
      val status = if (options.hasKey("status")) options.getString("status") else null

      val notification = NotificationCompat.Builder(reactContext, channelId)
        .setSmallIcon(reactContext.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setContentIntent(createContentIntent(bookingId, status))
        .setOngoing(true)
        .setAutoCancel(false)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setColor(Color.parseColor("#1A330E"))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .build()

      NotificationManagerCompat.from(reactContext).notify(NOTIFICATION_ID, notification)

      val payload = Arguments.createMap().apply {
        putBoolean("success", true)
        putString("notificationId", NATIVE_NOTIFICATION_ID)
        putInt("androidNotificationId", NOTIFICATION_ID)
      }
      promise.resolve(payload)
    } catch (securityError: SecurityException) {
      promise.reject("LEAF_RIDE_NOTIFICATION_PERMISSION", "Permissão de notificação indisponível.", securityError)
    } catch (error: Exception) {
      promise.reject("LEAF_RIDE_NOTIFICATION_FAILED", "Não foi possível atualizar a notificação da corrida.", error)
    }
  }

  @ReactMethod
  fun dismiss(promise: Promise) {
    try {
      NotificationManagerCompat.from(reactContext).cancel(NOTIFICATION_ID)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("LEAF_RIDE_NOTIFICATION_DISMISS_FAILED", "Não foi possível remover a notificação da corrida.", error)
    }
  }
}
