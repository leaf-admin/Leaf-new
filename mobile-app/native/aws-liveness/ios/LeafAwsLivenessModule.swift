import Foundation
import React
import SwiftUI
import UIKit
import AWSPluginsCore
import FaceLiveness

private struct LeafAwsTemporaryCredentials: AWSTemporaryCredentials {
  let sessionToken: String
  let expiration: Date
  let accessKeyId: String
  let secretAccessKey: String
}

private struct LeafAwsCredentialsProvider: AWSCredentialsProvider {
  let credentials: LeafAwsTemporaryCredentials

  func fetchAWSCredentials() async throws -> AWSCredentials {
    credentials
  }
}

private struct LeafAwsLivenessView: View {
  let sessionId: String
  let region: String
  let credentialsProvider: LeafAwsCredentialsProvider
  let onComplete: (Result<Void, Error>) -> Void

  @State private var isPresented = true

  var body: some View {
    FaceLivenessDetectorView(
      sessionID: sessionId,
      credentialsProvider: credentialsProvider,
      region: region,
      isPresented: $isPresented,
      onCompletion: { result in
        switch result {
        case .success:
          onComplete(.success(()))
        case .failure(let error):
          onComplete(.failure(error))
        }
      }
    )
    .ignoresSafeArea()
  }
}

@objc(LeafAwsLiveness)
final class LeafAwsLiveness: NSObject {
  private var activeResolve: RCTPromiseResolveBlock?
  private var activeReject: RCTPromiseRejectBlock?
  private weak var activeController: UIViewController?

  @objc
  static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc(start:resolver:rejecter:)
  func start(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard self.activeResolve == nil else {
        reject("AWS_LIVENESS_ALREADY_RUNNING", "Uma validação facial já está em andamento.", nil)
        return
      }

      guard
        let sessionId = options["sessionId"] as? String,
        !sessionId.isEmpty,
        let region = options["region"] as? String,
        !region.isEmpty,
        let credentials = options["credentials"] as? NSDictionary,
        let accessKeyId = credentials["accessKeyId"] as? String,
        !accessKeyId.isEmpty,
        let secretAccessKey = credentials["secretAccessKey"] as? String,
        !secretAccessKey.isEmpty,
        let sessionToken = credentials["sessionToken"] as? String,
        !sessionToken.isEmpty
      else {
        reject("AWS_LIVENESS_INVALID_OPTIONS", "Sessão ou credenciais AWS inválidas.", nil)
        return
      }

      let expiration = Self.parseExpiration(credentials["expiration"]) ?? Date().addingTimeInterval(15 * 60)
      let provider = LeafAwsCredentialsProvider(
        credentials: LeafAwsTemporaryCredentials(
          sessionToken: sessionToken,
          expiration: expiration,
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey
        )
      )

      guard let presenter = Self.topMostViewController() else {
        reject("AWS_LIVENESS_NO_PRESENTER", "Não foi possível abrir a validação facial.", nil)
        return
      }

      self.activeResolve = resolve
      self.activeReject = reject

      let view = LeafAwsLivenessView(
        sessionId: sessionId,
        region: region,
        credentialsProvider: provider,
        onComplete: { [weak self] result in
          DispatchQueue.main.async {
            self?.finish(result: result, sessionId: sessionId)
          }
        }
      )

      let controller = UIHostingController(rootView: view)
      controller.modalPresentationStyle = .fullScreen
      self.activeController = controller
      presenter.present(controller, animated: true)
    }
  }

  private func finish(result: Result<Void, Error>, sessionId: String) {
    let resolve = activeResolve
    let reject = activeReject
    activeResolve = nil
    activeReject = nil

    let complete = {
      switch result {
      case .success:
        resolve?([
          "success": true,
          "sessionId": sessionId,
        ])
      case .failure(let error):
        reject?("AWS_LIVENESS_FAILED", error.localizedDescription, error)
      }
    }

    if let activeController {
      activeController.dismiss(animated: true) {
        complete()
      }
    } else {
      complete()
    }

    activeController = nil
  }

  private static func parseExpiration(_ value: Any?) -> Date? {
    if let date = value as? Date {
      return date
    }
    guard let raw = value as? String, !raw.isEmpty else {
      return nil
    }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = formatter.date(from: raw) {
      return parsed
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: raw)
  }

  private static func topMostViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }

    let root = scenes
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }?
      .rootViewController

    var current = root
    while let presented = current?.presentedViewController {
      current = presented
    }
    return current
  }
}
