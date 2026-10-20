package br.com.leaf.ride

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import kotlin.math.abs
import kotlin.math.min

/**
 * A corrida por cima do app de navegação, no lugar de uma notificação aberta no topo
 * da tela. Um só por processo. Toque no card abre o Leaf; o botão abre o Leaf já
 * executando a ação da etapa (Cheguei, Iniciar, Encerrar). Arrastar para cima recolhe
 * numa pílula pequena (para liberar a faixa de instruções do Waze/Maps); tocar ou
 * puxar a pílula para baixo abre de novo.
 */
@SuppressLint("StaticFieldLeak")
object LeafRideOverlayWindow {
  private const val REQUEST_OPEN = 7710
  private const val REQUEST_ACTION = 7711
  private const val MAX_CARD_WIDTH_DP = 480

  /** Cores do app (robotaxiPrototypeTokens): claro de dia, "Leaf Ambient" à noite. */
  private class Palette(
    val panel: Int,
    val border: Int,
    val text: Int,
    val secondary: Int,
    val accent: Int,
    val onAccent: Int,
    val iconTile: Int,
    val icon: Int,
    val rail: Int,
    val grabber: Int,
    val ripple: Int
  )

  private val LIGHT = Palette(
    panel = 0xFFFFFFFF.toInt(),
    border = 0xFFE5E5E5.toInt(),
    text = 0xFF222222.toInt(),
    secondary = 0xFF6A6A6A.toInt(),
    accent = 0xFF1A330E.toInt(),
    onAccent = 0xFFFFFFFF.toInt(),
    iconTile = 0xFFF1F5EE.toInt(),
    icon = 0xFF1A330E.toInt(),
    rail = 0xFFE5E5E5.toInt(),
    grabber = 0xFFD6D9D6.toInt(),
    ripple = 0x331A330E
  )

  private val DARK = Palette(
    panel = 0xFF161D10.toInt(),
    border = 0xFF252E1B.toInt(),
    text = 0xFFF2F1EC.toInt(),
    secondary = 0xFFB8B2A8.toInt(),
    accent = 0xFFD4E84A.toInt(),
    onAccent = 0xFF0E1409.toInt(),
    iconTile = 0xFF24301B.toInt(),
    icon = 0xFFD4E84A.toInt(),
    rail = 0xFF333F23.toInt(),
    grabber = 0xFF333F23.toInt(),
    ripple = 0x33D4E84A
  )

  private const val LIME = 0xFFD4E84A.toInt()

  private var root: FrameLayout? = null
  private var card: LinearLayout? = null
  private var pill: LinearLayout? = null
  private var titleView: TextView? = null
  private var etaView: TextView? = null
  private var subtitleView: TextView? = null
  private var pillTextView: TextView? = null
  private var trackView: TrackView? = null
  private var actionView: TextView? = null
  private var params: WindowManager.LayoutParams? = null
  private var state: LeafRideOverlayState? = null
  private var renderedLegKey: String? = null
  private var collapsed = false
  private var palette: Palette = LIGHT
  private var fonts: Fonts? = null

  fun show(context: Context, next: LeafRideOverlayState) {
    state = next
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val wantedPalette = paletteFor(context)
    if (root != null && wantedPalette !== palette) {
      // Mudou dia/noite: refaz a vista com as cores certas (recolhido continua recolhido).
      removeView()
    }
    if (root == null) {
      palette = wantedPalette
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
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        x = 0
        y = statusBarHeight(context)
      }
      params = layoutParams
      applyMode(context, layoutParams)
      windowManager.addView(root, layoutParams)
    }
    render(context, next)
  }

  fun hide() {
    removeView()
    // A próxima corrida começa com o card aberto.
    collapsed = false
  }

  private fun removeView() {
    val view = root ?: return
    try {
      (view.context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(view)
    } catch (_: Exception) {
      // já removido
    }
    root = null
    card = null
    pill = null
    titleView = null
    etaView = null
    subtitleView = null
    pillTextView = null
    trackView = null
    actionView = null
    params = null
    renderedLegKey = null
  }

  private fun render(context: Context, next: LeafRideOverlayState) {
    titleView?.text = next.title
    val eta = next.shortText.trim()
    etaView?.text = eta
    etaView?.visibility = if (eta.isEmpty()) View.GONE else View.VISIBLE
    pillTextView?.text = if (eta.isNotEmpty()) eta else next.title
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
          send(LeafRideOverlayState.openLeafIntent(context, next.actionId, next.bookingId, REQUEST_ACTION))
        }
      } else {
        visibility = View.GONE
        setOnClickListener(null)
      }
    }
  }

  private fun setCollapsed(context: Context, value: Boolean) {
    if (collapsed == value) return
    val view = root ?: return
    val layoutParams = params ?: return
    collapsed = value
    view.animate().cancel()
    view.alpha = 0f
    view.translationY = -dp(context, 12).toFloat()
    applyMode(context, layoutParams)
    try {
      (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).updateViewLayout(view, layoutParams)
    } catch (_: Exception) {
      return
    }
    view.animate().alpha(1f).translationY(0f).setDuration(180).setInterpolator(DecelerateInterpolator()).start()
  }

  private fun applyMode(context: Context, layoutParams: WindowManager.LayoutParams) {
    card?.visibility = if (collapsed) View.GONE else View.VISIBLE
    pill?.visibility = if (collapsed) View.VISIBLE else View.GONE
    layoutParams.width = if (collapsed) {
      WindowManager.LayoutParams.WRAP_CONTENT
    } else {
      min(context.resources.displayMetrics.widthPixels, dp(context, MAX_CARD_WIDTH_DP))
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun build(context: Context) {
    val p = palette
    val f = fonts ?: Fonts.load(context).also { fonts = it }
    // A margem em volta do card deixa a sombra aparecer dentro da janela.
    val shadowRoom = dp(context, 8)
    val container = FrameLayout(context).apply {
      setPadding(shadowRoom, dp(context, 4), shadowRoom, shadowRoom + dp(context, 4))
      clipToPadding = false
      clipChildren = false
    }

    // ---- card aberto ----
    val cardView = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(context, 14), dp(context, 12), dp(context, 14), dp(context, 8))
      background = GradientDrawable().apply {
        cornerRadius = dp(context, 22).toFloat()
        setColor(p.panel)
        setStroke(dp(context, 1), p.border)
      }
      elevation = dp(context, 6).toFloat()
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
    }

    val header = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val iconTile = FrameLayout(context).apply {
      background = GradientDrawable().apply {
        cornerRadius = dp(context, 12).toFloat()
        setColor(p.iconTile)
      }
      layoutParams = LinearLayout.LayoutParams(dp(context, 40), dp(context, 40)).apply {
        marginEnd = dp(context, 12)
      }
      addView(carIcon(context, p.icon, 22), FrameLayout.LayoutParams(dp(context, 22), dp(context, 22), Gravity.CENTER))
    }
    val texts = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    }
    val titleRow = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    titleView = TextView(context).apply {
      setTextColor(p.text)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = f.semiBold
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      includeFontPadding = false
      layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    }
    etaView = TextView(context).apply {
      setTextColor(p.accent)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = f.bold
      maxLines = 1
      includeFontPadding = false
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      ).apply { marginStart = dp(context, 10) }
      visibility = View.GONE
    }
    titleRow.addView(titleView)
    titleRow.addView(etaView)
    subtitleView = TextView(context).apply {
      setTextColor(p.secondary)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      typeface = f.regular
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      includeFontPadding = false
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      ).apply { topMargin = dp(context, 4) }
    }
    texts.addView(titleRow)
    texts.addView(subtitleView)
    header.addView(iconTile)
    header.addView(texts)

    trackView = TrackView(context, p).apply {
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(context, 18)
      ).apply { topMargin = dp(context, 10) }
    }

    actionView = TextView(context).apply {
      setTextColor(p.onAccent)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = f.semiBold
      gravity = Gravity.CENTER
      includeFontPadding = false
      minHeight = dp(context, 46)
      val shape = GradientDrawable().apply {
        cornerRadius = dp(context, 14).toFloat()
        setColor(p.accent)
      }
      background = RippleDrawable(ColorStateList.valueOf(p.ripple), shape, null)
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      ).apply { topMargin = dp(context, 12) }
      visibility = View.GONE
    }

    // Puxador: avisa que o card sobe (recolhe).
    val grabber = View(context).apply {
      background = GradientDrawable().apply {
        cornerRadius = dp(context, 2).toFloat()
        setColor(p.grabber)
      }
      layoutParams = LinearLayout.LayoutParams(dp(context, 36), dp(context, 4)).apply {
        gravity = Gravity.CENTER_HORIZONTAL
        topMargin = dp(context, 10)
      }
    }

    cardView.addView(header)
    cardView.addView(trackView)
    cardView.addView(actionView)
    cardView.addView(grabber)

    // ---- pílula recolhida ----
    val pillView = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(context, 12), dp(context, 8), dp(context, 14), dp(context, 8))
      background = GradientDrawable().apply {
        cornerRadius = dp(context, 20).toFloat()
        setColor(p.panel)
        setStroke(dp(context, 1), p.border)
      }
      elevation = dp(context, 6).toFloat()
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.CENTER_HORIZONTAL
      )
      visibility = View.GONE
    }
    val pillDot = View(context).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(LIME)
        setStroke(dp(context, 2), p.accent)
      }
      layoutParams = LinearLayout.LayoutParams(dp(context, 10), dp(context, 10)).apply {
        marginEnd = dp(context, 8)
      }
    }
    pillTextView = TextView(context).apply {
      setTextColor(p.text)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      typeface = f.semiBold
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      maxWidth = dp(context, 200)
      includeFontPadding = false
    }
    pillView.addView(carIcon(context, p.icon, 18), LinearLayout.LayoutParams(dp(context, 18), dp(context, 18)).apply {
      marginEnd = dp(context, 8)
    })
    pillView.addView(pillDot)
    pillView.addView(pillTextView)

    container.addView(cardView)
    container.addView(pillView)

    attachGestures(context, container)
    card = cardView
    pill = pillView
    root = container
  }

  /**
   * Toque abre o Leaf (ou abre a pílula). Arrastar para cima recolhe, para baixo
   * abre. O card acompanha o dedo só na vertical e volta ao lugar ao soltar.
   */
  @SuppressLint("ClickableViewAccessibility")
  private fun attachGestures(context: Context, container: FrameLayout) {
    val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    val swipeDistance = dp(context, 36)
    var downRawY = 0f
    var dragging = false
    container.setOnTouchListener { view, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downRawY = event.rawY
          dragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dy = event.rawY - downRawY
          if (!dragging && abs(dy) > touchSlop) dragging = true
          if (dragging && !collapsed) view.translationY = min(0f, dy)
          true
        }
        MotionEvent.ACTION_UP -> {
          val dy = event.rawY - downRawY
          view.animate().translationY(0f).setDuration(120).start()
          when {
            dragging && dy <= -swipeDistance && !collapsed -> setCollapsed(context, true)
            dragging && dy >= swipeDistance && collapsed -> setCollapsed(context, false)
            !dragging && collapsed -> setCollapsed(context, false)
            !dragging -> send(LeafRideOverlayState.openLeafIntent(context, null, state?.bookingId ?: "", REQUEST_OPEN))
          }
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          view.animate().translationY(0f).setDuration(120).start()
          true
        }
        else -> false
      }
    }
  }

  private fun send(intent: PendingIntent) {
    try {
      intent.send()
    } catch (_: PendingIntent.CanceledException) {
      // O Leaf foi fechado de vez; o próximo toque gera um intent novo.
    }
  }

  private fun carIcon(context: Context, color: Int, sizeDp: Int): ImageView =
    ImageView(context).apply {
      val id = context.resources.getIdentifier("leaf_ride_car", "drawable", context.packageName)
      if (id != 0) setImageResource(id)
      imageTintList = ColorStateList.valueOf(color)
      layoutParams = ViewGroup.LayoutParams(dp(context, sizeDp), dp(context, sizeDp))
    }

  private fun paletteFor(context: Context): Palette {
    val night = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    return if (night == Configuration.UI_MODE_NIGHT_YES) DARK else LIGHT
  }

  private fun statusBarHeight(context: Context): Int {
    val id = context.resources.getIdentifier("status_bar_height", "dimen", "android")
    return if (id > 0) context.resources.getDimensionPixelSize(id) else dp(context, 24)
  }

  private fun dp(context: Context, value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

  /**
   * Figtree, a fonte do app. O bundle do RN a põe em res/raw; Typeface só lê de
   * arquivo, então copiamos uma vez para o cache. Sem ela, a fonte do sistema.
   */
  private class Fonts(val regular: Typeface, val semiBold: Typeface, val bold: Typeface) {
    companion object {
      fun load(context: Context): Fonts = Fonts(
        regular = font(context, "figtree_400regular", Typeface.NORMAL),
        semiBold = font(context, "figtree_600semibold", Typeface.BOLD),
        bold = font(context, "figtree_700bold", Typeface.BOLD)
      )

      private fun font(context: Context, weight: String, fallbackStyle: Int): Typeface {
        val fallback = Typeface.create("sans-serif", fallbackStyle)
        return try {
          val name = "_node_modules_expogooglefonts_figtree_${weight}_figtree_$weight"
          val id = context.resources.getIdentifier(name, "raw", context.packageName)
          if (id == 0) return fallback
          val file = File(context.cacheDir, "leaf-overlay-$weight.ttf")
          if (!file.exists() || file.length() == 0L) {
            context.resources.openRawResource(id).use { input ->
              file.outputStream().use { output -> input.copyTo(output) }
            }
          }
          Typeface.createFromFile(file)
        } catch (_: Exception) {
          fallback
        }
      }
    }
  }

  /** A corrida como linha fina: trilho, parte percorrida, ponto de chegada e a posição. */
  private class TrackView(context: Context, palette: Palette) : View(context) {
    private var progress = 0f
    private var animator: ValueAnimator? = null
    private val density = context.resources.displayMetrics.density
    private val rail = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = palette.rail; strokeWidth = 4 * density; strokeCap = Paint.Cap.ROUND
    }
    private val done = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = palette.accent; strokeWidth = 4 * density; strokeCap = Paint.Cap.ROUND
    }
    private val endFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = palette.panel }
    private val endRing = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = palette.accent; style = Paint.Style.STROKE; strokeWidth = 2.5f * density
    }
    private val head = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = palette.accent }
    private val headCore = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = LIME }

    fun reset() {
      animator?.cancel()
      progress = 0f
      invalidate()
    }

    fun animateTo(target: Float) {
      // Só para frente: um GPS que oscila não leva a posição para trás.
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
      val headRadius = 7 * density
      val y = height / 2f
      val start = headRadius
      val end = width - headRadius
      val headX = start + (end - start) * progress
      canvas.drawLine(start, y, end, y, rail)
      if (headX > start) canvas.drawLine(start, y, headX, y, done)
      canvas.drawCircle(end, y, 5 * density, endFill)
      canvas.drawCircle(end, y, 5 * density, endRing)
      canvas.drawCircle(headX, y, headRadius, head)
      canvas.drawCircle(headX, y, 3 * density, headCore)
    }
  }
}
