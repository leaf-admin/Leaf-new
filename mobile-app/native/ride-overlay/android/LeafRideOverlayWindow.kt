package br.com.leaf.ride

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/**
 * Balão da corrida por cima do app de navegação. Um só por processo; arrastável, e a
 * posição fica guardada enquanto o app vive. Toque no corpo abre o Leaf; o botão abre
 * o Leaf já executando a ação da etapa (Cheguei, Iniciar, Encerrar).
 */
@SuppressLint("StaticFieldLeak")
object LeafRideOverlayWindow {
  private const val INK = 0xFF1A330E.toInt()
  private const val LIME = 0xFFD4E84A.toInt()
  private const val REQUEST_OPEN = 7710
  private const val REQUEST_ACTION = 7711

  private var root: LinearLayout? = null
  private var titleView: TextView? = null
  private var subtitleView: TextView? = null
  private var trackView: TrackView? = null
  private var actionView: TextView? = null
  private var params: WindowManager.LayoutParams? = null
  private var lastX: Int? = null
  private var lastY: Int? = null
  private var state: LeafRideOverlayState? = null
  private var renderedLegKey: String? = null

  fun show(context: Context, next: LeafRideOverlayState) {
    state = next
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    if (root == null) {
      build(context)
      val layoutParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
          WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
          @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.START
        // Abaixo da faixa de instruções do Waze/Maps e acima da barra de ETA deles.
        x = lastX ?: dp(context, 12)
        y = lastY ?: (context.resources.displayMetrics.heightPixels * 0.42).toInt()
      }
      params = layoutParams
      windowManager.addView(root, layoutParams)
    }
    render(context, next)
  }

  fun hide() {
    val view = root ?: return
    try {
      (view.context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(view)
    } catch (_: Exception) {
      // já removido
    }
    root = null
    titleView = null
    subtitleView = null
    trackView = null
    actionView = null
    params = null
    renderedLegKey = null
  }

  private fun render(context: Context, next: LeafRideOverlayState) {
    titleView?.text = next.title
    subtitleView?.text = listOf(next.subtitle, next.body).filter { it.isNotBlank() }.joinToString(" · ")
    subtitleView?.visibility = if (subtitleView?.text.isNullOrBlank()) View.GONE else View.VISIBLE
    if (renderedLegKey != next.legKey) {
      renderedLegKey = next.legKey
      trackView?.reset()
    }
    trackView?.visibility = if (next.progress >= 0) View.VISIBLE else View.GONE
    if (next.progress >= 0) trackView?.animateTo(next.progress.coerceIn(0.0, 1.0).toFloat())
    actionView?.apply {
      if (next.actionId.isNotBlank() && next.actionLabel.isNotBlank()) {
        text = next.actionLabel
        visibility = View.VISIBLE
        setOnClickListener {
          LeafRideOverlayState.openLeafIntent(context, next.actionId, next.bookingId, REQUEST_ACTION).send()
        }
      } else {
        visibility = View.GONE
        setOnClickListener(null)
      }
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun build(context: Context) {
    val padding = dp(context, 12)
    val container = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(padding, dp(context, 10), padding, padding)
      background = GradientDrawable().apply {
        cornerRadius = dp(context, 18).toFloat()
        setColor(INK)
      }
      elevation = dp(context, 8).toFloat()
      minimumWidth = dp(context, 236)
    }
    titleView = TextView(context).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = Typeface.DEFAULT_BOLD
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      maxWidth = dp(context, 260)
    }
    subtitleView = TextView(context).apply {
      setTextColor(0xCCFFFFFF.toInt())
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      maxWidth = dp(context, 260)
    }
    trackView = TrackView(context).apply {
      layoutParams = LinearLayout.LayoutParams(dp(context, 236), dp(context, 26)).apply {
        topMargin = dp(context, 6)
      }
    }
    actionView = TextView(context).apply {
      setTextColor(INK)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setPadding(dp(context, 14), dp(context, 9), dp(context, 14), dp(context, 9))
      background = GradientDrawable().apply {
        cornerRadius = dp(context, 14).toFloat()
        setColor(LIME)
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply { topMargin = dp(context, 8) }
      visibility = View.GONE
    }
    container.addView(titleView)
    container.addView(subtitleView)
    container.addView(trackView)
    container.addView(actionView)

    val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    var downRawX = 0f
    var downRawY = 0f
    var startX = 0
    var startY = 0
    var dragging = false
    container.setOnTouchListener { view, event ->
      val layoutParams = params ?: return@setOnTouchListener false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downRawX = event.rawX
          downRawY = event.rawY
          startX = layoutParams.x
          startY = layoutParams.y
          dragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downRawX
          val dy = event.rawY - downRawY
          if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) dragging = true
          if (dragging) {
            layoutParams.x = (startX + dx).toInt()
            layoutParams.y = (startY + dy).toInt()
            lastX = layoutParams.x
            lastY = layoutParams.y
            (view.context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
              .updateViewLayout(view, layoutParams)
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (!dragging) {
            LeafRideOverlayState.openLeafIntent(context, null, state?.bookingId ?: "", REQUEST_OPEN).send()
          }
          true
        }
        else -> false
      }
    }
    root = container
  }

  private fun dp(context: Context, value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

  /** A corrida como linha: trilho, parte percorrida, pino no fim e o carro deslizando. */
  private class TrackView(context: Context) : View(context) {
    private var progress = 0f
    private var animator: ValueAnimator? = null
    private val density = context.resources.displayMetrics.density
    private val rail = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x40FFFFFF; strokeWidth = 4 * density; strokeCap = Paint.Cap.ROUND }
    private val done = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = LIME; strokeWidth = 4 * density; strokeCap = Paint.Cap.ROUND }
    private val pin = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val car = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = LIME }
    private val carEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = INK; style = Paint.Style.STROKE; strokeWidth = 2 * density }
    private val glyph = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 11 * density; textAlign = Paint.Align.CENTER }

    fun reset() {
      animator?.cancel()
      progress = 0f
      invalidate()
    }

    fun animateTo(target: Float) {
      // Só para frente: um GPS que oscila não leva o carro para trás.
      val next = maxOf(progress, target)
      animator?.cancel()
      animator = ValueAnimator.ofFloat(progress, next).apply {
        duration = 900
        interpolator = DecelerateInterpolator()
        addUpdateListener { progress = it.animatedValue as Float; invalidate() }
        start()
      }
    }

    override fun onDraw(canvas: Canvas) {
      val radius = 10 * density
      val y = height / 2f
      val start = radius
      val end = width - radius
      val carX = start + (end - start) * progress
      canvas.drawLine(start, y, end, y, rail)
      canvas.drawLine(start, y, carX, y, done)
      canvas.drawCircle(end, y, 4.5f * density, pin)
      canvas.drawCircle(carX, y, radius, car)
      canvas.drawCircle(carX, y, radius, carEdge)
      canvas.drawText("🚗", carX, y + glyph.textSize / 3f, glyph)
    }
  }
}
