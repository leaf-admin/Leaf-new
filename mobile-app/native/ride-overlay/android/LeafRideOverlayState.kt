package br.com.leaf.ride

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ReadableMap

/** O que o balão e o Live Update mostram. Vem pronto do JS (mesmo texto da notificação). */
data class LeafRideOverlayState(
  val bookingId: String,
  val title: String,
  val subtitle: String,
  val body: String,
  /** 0..1; negativo esconde a trilha. */
  val progress: Double,
  /** Texto curto do chip do Android 16 ("4 min"). */
  val shortText: String,
  val actionId: String,
  val actionLabel: String,
  /** Muda quando a etapa muda (embarque → viagem): a trilha recomeça do zero. */
  val legKey: String
) {
  companion object {
    fun fromMap(map: ReadableMap?): LeafRideOverlayState {
      fun text(key: String) = if (map != null && map.hasKey(key) && !map.isNull(key)) map.getString(key) ?: "" else ""
      val progress = if (map != null && map.hasKey("progress") && !map.isNull("progress")) map.getDouble("progress") else -1.0
      return LeafRideOverlayState(
        bookingId = text("bookingId"),
        title = text("title").ifBlank { "Corrida em andamento" },
        subtitle = text("subtitle"),
        body = text("body"),
        progress = progress,
        shortText = text("shortText"),
        actionId = text("actionId"),
        actionLabel = text("actionLabel"),
        legKey = text("legKey")
      )
    }

    /** Abre o Leaf na tela do motorista; com `action`, o JS executa a ação ao chegar. */
    fun openLeafIntent(context: Context, action: String?, bookingId: String, requestCode: Int): PendingIntent {
      val uri = Uri.Builder()
        .scheme("leafapp")
        .authority("robotaxi")
        .path("home")
        .apply {
          if (!action.isNullOrBlank()) appendQueryParameter("rideAction", action)
          if (bookingId.isNotBlank()) appendQueryParameter("rideBookingId", bookingId)
        }
        .build()
      val intent = Intent(Intent.ACTION_VIEW, uri)
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      return PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
  }
}
