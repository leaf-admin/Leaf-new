package br.com.leaf.ride

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class LeafFaceEmbeddingModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    private const val MODEL_ASSET_PATH = "face_models/arcface_w600k_r50.onnx"
    private const val MODEL_MODE = "mobile_arcface_w600k_r50_v1"
    private const val EMBEDDING_FORMAT = "float32-l2-normalized-512"
  }

  override fun getName(): String = "LeafFaceEmbedding"

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(buildStatus())
  }

  @ReactMethod
  fun generateEmbedding(options: ReadableMap, promise: Promise) {
    if (!isModelBundled()) {
      promise.reject(
        "FACE_EMBEDDING_MODEL_MISSING",
        "ArcFace model is not bundled in the app. Falling back to server/legacy verification."
      )
      return
    }

    promise.reject(
      "FACE_EMBEDDING_RUNTIME_NOT_CONFIGURED",
      "ArcFace native runtime is not configured for Android yet. Keep fallback enabled."
    )
  }

  private fun buildStatus() = Arguments.createMap().apply {
    val bundled = isModelBundled()
    putBoolean("available", false)
    putBoolean("modelBundled", bundled)
    putBoolean("runtimeConfigured", false)
    putString("platform", "android")
    putString("mode", MODEL_MODE)
    putString("embeddingFormat", EMBEDDING_FORMAT)
    putString("modelAssetPath", MODEL_ASSET_PATH)
    putString(
      "reason",
      if (bundled) "runtime_not_configured" else "model_missing"
    )
  }

  private fun isModelBundled(): Boolean {
    return try {
      reactContext.assets.open(MODEL_ASSET_PATH).use { true }
    } catch (_: Exception) {
      false
    }
  }
}
