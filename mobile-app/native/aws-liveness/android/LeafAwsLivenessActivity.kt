package br.com.leaf.ride

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import com.amplifyframework.auth.AWSCredentials
import com.amplifyframework.auth.AWSCredentialsProvider
import com.amplifyframework.auth.AWSTemporaryCredentials
import com.amplifyframework.auth.AuthException
import com.amplifyframework.core.Consumer
import com.amplifyframework.ui.liveness.ui.FaceLivenessDetector
import aws.smithy.kotlin.runtime.time.Instant
import java.time.OffsetDateTime
import java.util.concurrent.atomic.AtomicBoolean

private val LeafLivenessColorScheme = lightColorScheme(
  primary = Color(0xFF1A330E),
  onPrimary = Color.White,
  background = Color(0xFFF8F6F1),
  onBackground = Color(0xFF171412),
  surface = Color.White,
  onSurface = Color(0xFF171412),
  error = Color(0xFFD7153A),
  onError = Color.White,
  errorContainer = Color(0xFFFFF1F2),
  onErrorContainer = Color(0xFF171412)
)

class LeafAwsLivenessActivity : ComponentActivity() {
  companion object {
    const val EXTRA_SESSION_ID = "sessionId"
    const val EXTRA_REGION = "region"
    const val EXTRA_ACCESS_KEY_ID = "accessKeyId"
    const val EXTRA_SECRET_ACCESS_KEY = "secretAccessKey"
    const val EXTRA_SESSION_TOKEN = "sessionToken"
    const val EXTRA_EXPIRATION = "expiration"
    private const val TAG = "LeafAwsLiveness"
  }

  private val terminalHandled = AtomicBoolean(false)
  private var sessionId: String = ""

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty()
    val region = intent.getStringExtra(EXTRA_REGION).orEmpty()
    val accessKeyId = intent.getStringExtra(EXTRA_ACCESS_KEY_ID).orEmpty()
    val secretAccessKey = intent.getStringExtra(EXTRA_SECRET_ACCESS_KEY).orEmpty()
    val sessionToken = intent.getStringExtra(EXTRA_SESSION_TOKEN).orEmpty()
    val expiration = intent.getStringExtra(EXTRA_EXPIRATION)

    if (!LeafAwsLivenessPromiseRegistry.attach(this, sessionId)) {
      terminalHandled.set(true)
      finish()
      return
    }

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        cancelAndFinish()
      }
    })

    if (
      sessionId.isBlank()
      || region.isBlank()
      || accessKeyId.isBlank()
      || secretAccessKey.isBlank()
      || sessionToken.isBlank()
    ) {
      failAndFinish(
        "AWS_LIVENESS_INVALID_OPTIONS",
        "Sessão ou credenciais AWS inválidas."
      )
      return
    }

    val credentialsProvider = LeafStaticCredentialsProvider(
      AWSTemporaryCredentials(
        accessKeyId,
        secretAccessKey,
        sessionToken,
        parseExpiration(expiration)
      )
    )

    setContent {
      MaterialTheme(
        colorScheme = LeafLivenessColorScheme
      ) {
        FaceLivenessDetector(
          sessionId = sessionId,
          region = region,
          credentialsProvider = credentialsProvider,
          disableStartView = true,
          onComplete = {
            completeAndFinish()
          },
          onError = { error ->
            Log.e(TAG, "Erro durante liveness AWS: ${error.message}", error.throwable)
            failAndFinish(
              "AWS_LIVENESS_FAILED",
              error.message ?: "Não foi possível concluir a validação facial.",
              error.throwable
            )
          }
        )
      }
    }
  }

  internal fun finishFromBridge() {
    runOnUiThread {
      terminalHandled.set(true)
      if (!isFinishing) {
        finish()
      }
    }
  }

  override fun onDestroy() {
    LeafAwsLivenessPromiseRegistry.detach(this)
    if (terminalHandled.compareAndSet(false, true)) {
      LeafAwsLivenessPromiseRegistry.reject(
        sessionId,
        "AWS_LIVENESS_CANCELLED",
        "A validação facial foi encerrada."
      )
    }
    super.onDestroy()
  }

  private fun completeAndFinish() {
    if (terminalHandled.compareAndSet(false, true)) {
      LeafAwsLivenessPromiseRegistry.resolve(sessionId)
    }
    if (!isFinishing) {
      finish()
    }
  }

  private fun cancelAndFinish() {
    failAndFinish(
      "AWS_LIVENESS_CANCELLED",
      "A validação facial foi encerrada."
    )
  }

  private fun failAndFinish(
    code: String,
    message: String,
    throwable: Throwable? = null
  ) {
    if (terminalHandled.compareAndSet(false, true)) {
      LeafAwsLivenessPromiseRegistry.reject(sessionId, code, message, throwable)
    }
    if (!isFinishing) {
      finish()
    }
  }

  private fun parseExpiration(raw: String?): Instant {
    return try {
      val epochSeconds = OffsetDateTime.parse(raw).toEpochSecond()
      Instant.fromEpochSeconds(epochSeconds)
    } catch (_: Exception) {
      Instant.fromEpochSeconds((System.currentTimeMillis() / 1000L) + (15 * 60))
    }
  }
}

private class LeafStaticCredentialsProvider(
  private val credentials: AWSTemporaryCredentials
) : AWSCredentialsProvider<AWSCredentials> {
  override fun fetchAWSCredentials(
    onSuccess: Consumer<AWSCredentials>,
    onError: Consumer<AuthException>
  ) {
    onSuccess.accept(credentials)
  }
}
