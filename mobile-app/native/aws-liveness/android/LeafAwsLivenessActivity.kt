package br.com.leaf.ride

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import com.amplifyframework.auth.AWSCredentials
import com.amplifyframework.auth.AWSCredentialsProvider
import com.amplifyframework.auth.AWSTemporaryCredentials
import com.amplifyframework.auth.AuthException
import com.amplifyframework.core.Consumer
import com.amplifyframework.ui.liveness.ui.FaceLivenessDetector
import com.amplifyframework.ui.liveness.ui.LivenessColorScheme
import aws.smithy.kotlin.runtime.time.Instant
import java.time.OffsetDateTime

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

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty()
    val region = intent.getStringExtra(EXTRA_REGION).orEmpty()
    val accessKeyId = intent.getStringExtra(EXTRA_ACCESS_KEY_ID).orEmpty()
    val secretAccessKey = intent.getStringExtra(EXTRA_SECRET_ACCESS_KEY).orEmpty()
    val sessionToken = intent.getStringExtra(EXTRA_SESSION_TOKEN).orEmpty()
    val expiration = intent.getStringExtra(EXTRA_EXPIRATION)

    if (
      sessionId.isBlank()
      || region.isBlank()
      || accessKeyId.isBlank()
      || secretAccessKey.isBlank()
      || sessionToken.isBlank()
    ) {
      LeafAwsLivenessPromiseRegistry.reject(
        "AWS_LIVENESS_INVALID_OPTIONS",
        "Sessão ou credenciais AWS inválidas."
      )
      finish()
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
        colorScheme = LivenessColorScheme.default()
      ) {
        FaceLivenessDetector(
          sessionId = sessionId,
          region = region,
          credentialsProvider = credentialsProvider,
          onComplete = {
            LeafAwsLivenessPromiseRegistry.resolve(sessionId)
            finish()
          },
          onError = { error ->
            Log.e(TAG, "Erro durante liveness AWS: ${error.message}", error.throwable)
            LeafAwsLivenessPromiseRegistry.reject(
              "AWS_LIVENESS_FAILED",
              error.message ?: "Não foi possível concluir a validação facial.",
              error.throwable
            )
            finish()
          }
        )
      }
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
