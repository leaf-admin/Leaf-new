package br.com.leaf.ride

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import androidx.annotation.RequiresApi

/**
 * Android 16 "Live Update": a notificação da corrida promovida, com o carro andando
 * na trilha (ProgressStyle) e o ETA no chip da barra de status, visível por cima de
 * qualquer app em tela cheia. Abaixo do Android 16 o JS segue com a notificação do
 * notifee.
 */
object LeafRideLiveUpdate {
  private const val CHANNEL_ID = "leaf_ride_live_update"
  private const val NOTIFICATION_ID = 7720
  private const val REQUEST_OPEN = 7721
  private const val REQUEST_ACTION = 7722
  private const val INK = 0xFF1A330E.toInt()
  private const val LIME = 0xFF8DB51E.toInt()
  private const val ANDROID_16 = 36

  fun isSupported(): Boolean = Build.VERSION.SDK_INT >= ANDROID_16

  fun show(context: Context, state: LeafRideOverlayState) {
    if (!isSupported()) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannel(manager)
    manager.notify(NOTIFICATION_ID, build(context, state))
  }

  fun cancel(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(NOTIFICATION_ID)
  }

  private fun ensureChannel(manager: NotificationManager) {
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Corrida em andamento (Android 16)", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Corrida com o carro na trilha e o tempo na barra de status"
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
      }
    )
  }

  @RequiresApi(ANDROID_16)
  private fun build(context: Context, state: LeafRideOverlayState): Notification {
    val smallIcon = drawable(context, "ic_stat_leaf", android.R.drawable.ic_dialog_map)
    val carIcon = drawable(context, "leaf_ride_car", smallIcon)
    val percent = if (state.progress >= 0) (state.progress.coerceIn(0.0, 1.0) * 100).toInt() else 0

    val style = Notification.ProgressStyle()
      .setStyledByProgress(true)
      .setProgress(percent)
      .setProgressTrackerIcon(Icon.createWithResource(context, carIcon))
      .setProgressSegments(listOf(Notification.ProgressStyle.Segment(100).setColor(LIME)))
      .setProgressPoints(listOf(Notification.ProgressStyle.Point(100).setColor(INK)))

    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setColor(INK)
      .setContentTitle(state.title)
      .setContentText(state.body)
      .setSubText(state.subtitle)
      .setStyle(style)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_NAVIGATION)
      // Pedido de Live Update (EXTRA_REQUEST_PROMOTED_ONGOING): o sistema promove se a
      // notificação cumprir as regras (ongoing, com título, sem cor de fundo).
      .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
      .setContentIntent(LeafRideOverlayState.openLeafIntent(context, null, state.bookingId, REQUEST_OPEN))

    if (state.shortText.isNotBlank()) {
      builder.setShortCriticalText(state.shortText)
    }
    if (state.actionId.isNotBlank() && state.actionLabel.isNotBlank()) {
      builder.addAction(
        Notification.Action.Builder(
          Icon.createWithResource(context, smallIcon),
          state.actionLabel,
          LeafRideOverlayState.openLeafIntent(context, state.actionId, state.bookingId, REQUEST_ACTION)
        ).build()
      )
    }
    return builder.build()
  }

  private fun drawable(context: Context, name: String, fallback: Int): Int {
    val id = context.resources.getIdentifier(name, "drawable", context.packageName)
    return if (id != 0) id else fallback
  }
}
