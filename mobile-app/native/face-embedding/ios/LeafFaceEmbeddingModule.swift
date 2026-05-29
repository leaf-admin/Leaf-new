import Foundation
import React

@objc(LeafFaceEmbedding)
final class LeafFaceEmbedding: NSObject {
  private static let modelResourceName = "arcface_w600k_r50"
  private static let modelResourceExtension = "onnx"
  private static let modelSubdirectory = "FaceModels"
  private static let modelMode = "mobile_arcface_w600k_r50_v1"
  private static let embeddingFormat = "float32-l2-normalized-512"

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(getStatus:rejecter:)
  func getStatus(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(statusPayload())
  }

  @objc(generateEmbedding:resolver:rejecter:)
  func generateEmbedding(
    _ options: NSDictionary,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard Self.modelURL() != nil else {
      reject(
        "FACE_EMBEDDING_MODEL_MISSING",
        "ArcFace model is not bundled in the app. Falling back to server/legacy verification.",
        nil
      )
      return
    }

    reject(
      "FACE_EMBEDDING_RUNTIME_NOT_CONFIGURED",
      "ArcFace native runtime is not configured for iOS yet. Keep fallback enabled.",
      nil
    )
  }

  private func statusPayload() -> [String: Any] {
    let bundled = Self.modelURL() != nil
    return [
      "available": false,
      "modelBundled": bundled,
      "runtimeConfigured": false,
      "platform": "ios",
      "mode": Self.modelMode,
      "embeddingFormat": Self.embeddingFormat,
      "modelAssetPath": "\(Self.modelSubdirectory)/\(Self.modelResourceName).\(Self.modelResourceExtension)",
      "reason": bundled ? "runtime_not_configured" : "model_missing",
    ]
  }

  private static func modelURL() -> URL? {
    Bundle.main.url(
      forResource: modelResourceName,
      withExtension: modelResourceExtension,
      subdirectory: modelSubdirectory
    )
  }
}
