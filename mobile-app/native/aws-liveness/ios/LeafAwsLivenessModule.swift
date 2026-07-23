import Foundation
import React
import SwiftUI
import UIKit
import AVFoundation
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
  @State private var isLayoutReady = false

  var body: some View {
    GeometryReader { proxy in
      ZStack {
        Color(uiColor: .systemBackground)

        if isLayoutReady {
          FaceLivenessDetectorView(
            sessionID: sessionId,
            credentialsProvider: credentialsProvider,
            region: region,
            disableStartView: true,
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
          .frame(width: proxy.size.width, height: proxy.size.height)
        } else {
          ProgressView("Preparando validação facial...")
        }
      }
      .frame(width: proxy.size.width, height: proxy.size.height)
      .onAppear {
        markLayoutReady(for: proxy.size)
      }
      .onChange(of: proxy.size) { size in
        markLayoutReady(for: size)
      }
    }
    .ignoresSafeArea()
  }

  private func markLayoutReady(for size: CGSize) {
    guard !isLayoutReady, size.width > 0, size.height > 0 else { return }
    DispatchQueue.main.async {
      isLayoutReady = true
    }
  }
}

@objc(LeafAwsLiveness)
final class LeafAwsLiveness: NSObject, RCTInvalidating {
  private var activeResolve: RCTPromiseResolveBlock?
  private var activeReject: RCTPromiseRejectBlock?
  private var activeController: UIViewController?
  private var isClosing = false
  private var closingCompletion: (() -> Void)?

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
      guard
        self.activeResolve == nil,
        self.activeController == nil,
        !self.isClosing
      else {
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
      controller.loadViewIfNeeded()

      let presenterBounds = presenter.viewIfLoaded?.window?.bounds ?? presenter.view.bounds
      let initialBounds = presenterBounds.width > 0 && presenterBounds.height > 0
        ? presenterBounds
        : UIScreen.main.bounds
      controller.view.frame = initialBounds
      controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      controller.view.backgroundColor = .systemBackground
      controller.view.setNeedsLayout()
      controller.view.layoutIfNeeded()

      self.activeController = controller
      presenter.present(controller, animated: true) {
        guard self.activeController === controller else {
          controller.dismiss(animated: false)
          return
        }

        if self.isClosing {
          self.dismissActiveController(controller, animated: false)
          return
        }

        let presentedBounds = controller.view.window?.bounds ?? initialBounds
        controller.view.frame = presentedBounds
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        #if DEBUG
        Self.debugLogLayout(of: controller, label: "presented")
        for delay in [2.0, 10.0] {
          DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard self.activeController === controller else { return }
            Self.debugLogLayout(of: controller, label: "after-\(Int(delay))s")
          }
        }
        #endif
      }
    }
  }

  @objc(cancel:rejecter:)
  func cancel(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.cancelActiveSession(animated: true) { cancelled in
        resolve([
          "success": true,
          "cancelled": cancelled,
        ])
      }
    }
  }

  func invalidate() {
    DispatchQueue.main.async {
      self.cancelActiveSession(animated: false)
    }
  }

  private func finish(result: Result<Void, Error>, sessionId: String) {
    guard activeResolve != nil || activeReject != nil else {
      return
    }

    let resolve = activeResolve
    let reject = activeReject
    let controller = activeController
    activeResolve = nil
    activeReject = nil

    let complete: () -> Void = {
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

    beginClosing(controller, animated: true, completion: complete)
  }

  private func cancelActiveSession(
    animated: Bool,
    completion: ((Bool) -> Void)? = nil
  ) {
    if isClosing {
      completion?(true)
      return
    }

    let hadActiveSession =
      activeResolve != nil ||
      activeReject != nil ||
      activeController != nil

    guard hadActiveSession else {
      completion?(false)
      return
    }

    let reject = activeReject
    let controller = activeController
    activeResolve = nil
    activeReject = nil

    beginClosing(controller, animated: animated) {
      reject?(
        "AWS_LIVENESS_CANCELLED",
        "A validação facial foi encerrada.",
        nil
      )
      completion?(true)
    }
  }

  private func beginClosing(
    _ controller: UIViewController?,
    animated: Bool,
    completion: @escaping () -> Void
  ) {
    isClosing = true
    closingCompletion = completion

    guard let controller else {
      completeClosing(nil)
      return
    }

    guard controller.presentingViewController != nil || controller.viewIfLoaded?.window != nil else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
        guard
          self.isClosing,
          self.activeController === controller,
          controller.presentingViewController == nil,
          controller.viewIfLoaded?.window == nil
        else {
          return
        }
        self.completeClosing(controller)
      }
      return
    }

    dismissActiveController(controller, animated: animated)
  }

  private func dismissActiveController(
    _ controller: UIViewController,
    animated: Bool
  ) {
    controller.dismiss(animated: animated) {
      self.completeClosing(controller)
    }
  }

  private func completeClosing(_ controller: UIViewController?) {
    if let controller, activeController !== controller {
      return
    }

    activeController = nil
    isClosing = false
    let completion = closingCompletion
    closingCompletion = nil
    completion?()
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

  #if DEBUG
  private static func debugLogLayout(of controller: UIViewController, label: String) {
    let previewLayers = findPreviewLayers(in: controller.view.layer)
    let previews = previewLayers.map {
      "frame=\($0.frame),bounds=\($0.bounds),hidden=\($0.isHidden),opacity=\($0.opacity),running=\($0.session?.isRunning == true)"
    }
    print(
      "[LeafAwsLiveness][Layout] \(label) " +
      "host=\(controller.view.bounds) window=\(controller.view.window?.bounds ?? .zero) " +
      "previewCount=\(previewLayers.count) previews=\(previews)"
    )
  }

  private static func findPreviewLayers(in layer: CALayer) -> [AVCaptureVideoPreviewLayer] {
    var result = layer is AVCaptureVideoPreviewLayer ? [layer as! AVCaptureVideoPreviewLayer] : []
    for sublayer in layer.sublayers ?? [] {
      result.append(contentsOf: findPreviewLayers(in: sublayer))
    }
    return result
  }
  #endif
}
