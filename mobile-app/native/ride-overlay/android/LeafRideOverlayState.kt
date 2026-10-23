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
  val legKey: String,
  /** Texto curto da pílula recolhida ("A caminho", "No embarque"). */
  val pillText: String,
  /** Oferta de corrida: hora (epoch ms) em que o card some sozinho; 0 = não some. */
  val expiresAtMs: Long = 0L,
  /** Apresentação Faixa. O Live Update conserva os campos e textos anteriores. */
  val ribbonMetric: String = "",
  val ribbonMetricLabel: String = "",
  val ribbonPhase: String = "",
  val ribbonTitle: String = "",
  val ribbonDetail: String = "",
  val ribbonSummary: String = "",
  val ribbonCountdownSeconds: Double = 0.0
) {
  val hasAction: Boolean get() = actionId.isNotBlank() && actionLabel.isNotBlank()

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
        legKey = text("legKey"),
        pillText = text("pillText"),
        expiresAtMs = if (map != null && map.hasKey("expiresAtMs") && !map.isNull("expiresAtMs")) map.getDouble("expiresAtMs").toLong() else 0L,
        ribbonMetric = text("ribbonMetric"),
        ribbonMetricLabel = text("ribbonMetricLabel"),
        ribbonPhase = text("ribbonPhase"),
        ribbonTitle = text("ribbonTitle"),
        ribbonDetail = text("ribbonDetail"),
        ribbonSummary = text("ribbonSummary"),
        ribbonCountdownSeconds = if (map != null && map.hasKey("ribbonCountdownSeconds") && !map.isNull("ribbonCountdownSeconds")) map.getDouble("ribbonCountdownSeconds") else 0.0
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
