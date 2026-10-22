package br.com.leaf.ride

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.bridge.ReadableMap
import kotlin.math.ceil
import kotlin.math.min

/** O card de nova corrida, igual ao do app, para mostrar por cima do Waze/Maps. */
data class LeafOfferCardState(
  val bookingId: String,
  val fareLabel: String,
  val perKmLabel: String,
  val tollLabel: String,
  val tripLine: String,
  val pickupLabel: String,
  val dropoffLabel: String,
  val expiresAtMs: Long,
  val totalMs: Long
) {
  companion object {
    fun fromMap(map: ReadableMap?): LeafOfferCardState {
      fun text(key: String) = if (map != null && map.hasKey(key) && !map.isNull(key)) map.getString(key) ?: "" else ""
      fun number(key: String) = if (map != null && map.hasKey(key) && !map.isNull(key)) map.getDouble(key).toLong() else 0L
      return LeafOfferCardState(
        bookingId = text("bookingId"),
        fareLabel = text("fareLabel"),
        perKmLabel = text("perKmLabel"),
        tollLabel = text("tollLabel"),
        tripLine = text("tripLine"),
        pickupLabel = text("pickupLabel"),
        dropoffLabel = text("dropoffLabel"),
        expiresAtMs = number("expiresAtMs"),
        totalMs = number("totalMs").takeIf { it > 0 } ?: 20000L
      )
    }
  }
}

/**
 * Nova corrida por cima de outros apps (como Uber e 99): o mesmo card da tela do motorista,
 * na parte de baixo da tela, com o tempo correndo. "Aceitar corrida" abre o Leaf já aceitando
 * (o JS confere a oferta e aceita pelo caminho normal); o X só fecha o card. Some sozinho
 * quando a oferta vence, mesmo com o JS parado em segundo plano.
 */
@SuppressLint("StaticFieldLeak")
object LeafOfferCardWindow {
  private const val REQUEST_OPEN = 7720
  private const val REQUEST_ACCEPT = 7721
  private const val MAX_CARD_WIDTH_DP = 480
  private const val INK = 0xFF111410.toInt()
  private const val SECONDARY = 0xFF6A6A6A.toInt()
  private const val SOFT = 0xFFEEF4EA.toInt()
  private const val SOFT_INK = 0xFF1A330E.toInt()
  private const val DIVIDER = 0xFFE5E5E5.toInt()
  private const val BUTTON = 0xFF1F1F1F.toInt()

  private var root: FrameLayout? = null
  private var timerView: TextView? = null
  private var progressView: View? = null
  private var progressTrack: FrameLayout? = null
  private var state: LeafOfferCardState? = null
  private val handler = Handler(Looper.getMainLooper())
  private val tick = object : Runnable {
    override fun run() {
      val current = state ?: return
      val remaining = current.expiresAtMs - System.currentTimeMillis()
      if (remaining <= 0) {
        hide()
        return
      }
      val seconds = ceil(remaining / 1000.0).toInt()
      timerView?.text = String.format("00:%02d", min(seconds, 99))
      val track = progressTrack
      val bar = progressView
      if (track != null && bar != null && track.width > 0) {
        val ratio = (remaining.toFloat() / current.totalMs).coerceIn(0f, 1f)
        bar.layoutParams = bar.layoutParams.apply { width = (track.width * ratio).toInt() }
        bar.requestLayout()
      }
      handler.postDelayed(this, 250)
    }
  }

  fun show(context: Context, next: LeafOfferCardState) {
    if (state?.bookingId == next.bookingId && state?.expiresAtMs == next.expiresAtMs && root != null) return
    hide()
    state = next
    val app = context.applicationContext
    val view = build(app, next)
    val params = WindowManager.LayoutParams(
      min(app.resources.displayMetrics.widthPixels, dp(app, MAX_CARD_WIDTH_DP)),
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else
        @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      y = dp(app, 24)
    }
    (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager).addView(view, params)
    root = view
    view.alpha = 0f
    view.translationY = dp(app, 40).toFloat()
    view.animate().alpha(1f).translationY(0f).setDuration(220).setInterpolator(DecelerateInterpolator()).start()
    handler.post(tick)
  }

  fun hide() {
    handler.removeCallbacks(tick)
    val view = root
    root = null
    timerView = null
    progressView = null
    progressTrack = null
    state = null
    if (view != null) {
      try {
        (view.context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(view)
      } catch (_: Exception) {
        // já removido
      }
    }
  }

  private fun build(context: Context, s: LeafOfferCardState): FrameLayout {
    val fonts = Fonts(context)
    val container = FrameLayout(context).apply {
      setPadding(dp(context, 12), 0, dp(context, 12), 0)
      clipToPadding = false
    }
    val card = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(context, 22), dp(context, 20), dp(context, 22), dp(context, 18))
      background = GradientDrawable().apply {
        cornerRadius = dp(context, 28).toFloat()
        setColor(0xFFFFFFFF.toInt())
        setStroke(dp(context, 1), DIVIDER)
      }
      elevation = dp(context, 12).toFloat()
      setOnClickListener { open(context, null, s.bookingId, REQUEST_OPEN) }
    }

    // Nova corrida ............ 00:15
    val header = row(context)
    header.addView(text(context, "Nova corrida", 15f, SECONDARY, fonts.medium), weighted())
    timerView = text(context, "", 15f, SOFT_INK, fonts.semiBold).apply {
      setPadding(dp(context, 12), dp(context, 5), dp(context, 12), dp(context, 5))
      background = pill(context, SOFT)
    }
    header.addView(timerView)
    card.addView(header)

    // R$ 39,22 Líquido ....... R$ 2,00/km
    val fareRow = row(context).apply { setPadding(0, dp(context, 10), 0, 0) }
    fareRow.addView(text(context, s.fareLabel.ifBlank { "--" }, 30f, INK, fonts.semiBold))
    fareRow.addView(text(context, "Líquido", 15f, SECONDARY, fonts.medium).apply {
      setPadding(dp(context, 8), 0, 0, 0)
    }, weighted())
    if (s.perKmLabel.isNotBlank()) {
      fareRow.addView(text(context, s.perKmLabel, 14f, SOFT_INK, fonts.semiBold).apply {
        setPadding(dp(context, 10), dp(context, 5), dp(context, 10), dp(context, 5))
        background = pill(context, SOFT)
      })
    }
    card.addView(fareRow)

    if (s.tollLabel.isNotBlank()) {
      card.addView(text(context, s.tollLabel, 13f, SOFT_INK, fonts.medium).apply {
        setPadding(dp(context, 10), dp(context, 4), dp(context, 10), dp(context, 4))
        background = pill(context, 0xFFFFFFFF.toInt(), DIVIDER)
      }, LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      ).apply { topMargin = dp(context, 8) })
    }
    if (s.tripLine.isNotBlank()) {
      card.addView(text(context, s.tripLine, 16f, SECONDARY, fonts.regular).apply {
        setPadding(0, dp(context, 8), 0, 0)
      })
    }

    card.addView(View(context).apply { setBackgroundColor(DIVIDER) }, LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 1)
    ).apply { topMargin = dp(context, 14); bottomMargin = dp(context, 12) })
    if (s.pickupLabel.isNotBlank()) card.addView(stop(context, fonts, s.pickupLabel, square = false))
    if (s.dropoffLabel.isNotBlank()) card.addView(stop(context, fonts, s.dropoffLabel, square = true))

    // [X] [✓ Aceitar corrida]
    val buttons = row(context).apply { setPadding(0, dp(context, 16), 0, 0) }
    val decline = text(context, "✕", 22f, INK, fonts.medium).apply {
      gravity = Gravity.CENTER
      background = RippleDrawable(ColorStateList.valueOf(0x22000000), GradientDrawable().apply {
        cornerRadius = dp(context, 18).toFloat()
        setColor(0xFFF1F1F1.toInt())
      }, null)
      contentDescription = "Fechar"
      setOnClickListener { hide() }
    }
    buttons.addView(decline, LinearLayout.LayoutParams(dp(context, 64), dp(context, 60)).apply {
      marginEnd = dp(context, 12)
    })
    val accept = FrameLayout(context).apply {
      background = RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), GradientDrawable().apply {
        cornerRadius = dp(context, 18).toFloat()
        setColor(BUTTON)
      }, null)
      contentDescription = "Aceitar corrida"
      setOnClickListener {
        open(context, "accept_offer", s.bookingId, REQUEST_ACCEPT)
        hide()
      }
    }
    accept.addView(text(context, "✓  Aceitar corrida", 18f, 0xFFFFFFFF.toInt(), fonts.semiBold).apply {
      gravity = Gravity.CENTER
    }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    // Tempo que falta: barra fina no pé do botão, como no app.
    val track = FrameLayout(context).apply {
      background = pill(context, 0x55FFFFFF)
    }
    val bar = View(context).apply { background = pill(context, 0xFFFFFFFF.toInt()) }
    track.addView(bar, FrameLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT))
    accept.addView(track, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 3), Gravity.BOTTOM).apply {
      leftMargin = dp(context, 36)
      rightMargin = dp(context, 36)
      bottomMargin = dp(context, 7)
    })
    progressTrack = track
    progressView = bar
    buttons.addView(accept, LinearLayout.LayoutParams(0, dp(context, 60), 1f))
    card.addView(buttons)

    container.addView(card, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply { bottomMargin = dp(context, 12) })
    return container
  }

  private fun stop(context: Context, fonts: Fonts, label: String, square: Boolean): LinearLayout {
    val line = row(context).apply { setPadding(0, dp(context, 4), 0, dp(context, 4)) }
    line.addView(View(context).apply {
      background = GradientDrawable().apply {
        if (square) cornerRadius = dp(context, 2).toFloat() else shape = GradientDrawable.OVAL
        setColor(INK)
      }
    }, LinearLayout.LayoutParams(dp(context, 10), dp(context, 10)).apply { marginEnd = dp(context, 14) })
    line.addView(text(context, label, 17f, INK, fonts.medium), weighted())
    return line
  }

  private fun open(context: Context, action: String?, bookingId: String, requestCode: Int) {
    try {
      LeafRideOverlayState.openLeafIntent(context, action, bookingId, requestCode).send()
    } catch (_: Exception) {
      // Leaf fechado de vez: o próximo toque gera outro intent.
    }
  }

  private fun row(context: Context) = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
  }

  private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)

  private fun text(context: Context, value: String, sizeSp: Float, color: Int, face: Typeface) =
    TextView(context).apply {
      text = value
      setTextColor(color)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      typeface = face
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      includeFontPadding = false
    }

  private fun pill(context: Context, fill: Int, stroke: Int? = null) = GradientDrawable().apply {
    cornerRadius = dp(context, 999).toFloat()
    setColor(fill)
    if (stroke != null) setStroke(dp(context, 1), stroke)
  }

  private fun dp(context: Context, value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

  /** Figtree do app (mesmo arquivo copiado pelo balão da corrida); sem ela, a do sistema. */
  private class Fonts(context: Context) {
    val regular: Typeface = LeafRideOverlayWindow.font(context, "figtree_400regular", Typeface.NORMAL)
    val medium: Typeface = LeafRideOverlayWindow.font(context, "figtree_500medium", Typeface.NORMAL)
    val semiBold: Typeface = LeafRideOverlayWindow.font(context, "figtree_600semibold", Typeface.BOLD)
  }
}
