import Foundation
import React
import UserNotifications

@objc(LeafRideActivity)
final class LeafRideActivity: NSObject {
  private let notificationCenter = UNUserNotificationCenter.current()
  private let defaultActivityId = "leaf-ios-live-activity"

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(startOrUpdate:resolver:rejecter:)
  func startOrUpdate(
    _ payload: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let activityId = stringValue(payload, key: "activityId") ?? defaultActivityId
    let bookingId = stringValue(payload, key: "bookingId") ?? ""
    let categoryId = stringValue(payload, key: "notificationCategoryId") ?? "ride_status_update"

    let content = UNMutableNotificationContent()
    content.title = stringValue(payload, key: "title") ?? fallbackTitle(payload)
    content.subtitle = subtitle(payload)
    content.body = body(payload)
    content.sound = nil
    content.categoryIdentifier = categoryId
    content.threadIdentifier = bookingId.isEmpty ? activityId : "leaf.ride.\(bookingId)"
    content.userInfo = userInfo(payload, activityId: activityId)

    if #available(iOS 15.0, *) {
      content.interruptionLevel = .active
      content.relevanceScore = 0.85
    }

    let request = UNNotificationRequest(
      identifier: activityId,
      content: content,
      trigger: nil
    )

    notificationCenter.add(request) { error in
      if let error = error {
        reject(
          "LEAF_RIDE_ACTIVITY_UPDATE_FAILED",
          "Could not update the iOS ride notification surface.",
          error
        )
        return
      }

      resolve([
        "success": true,
        "activityId": activityId,
        "notificationId": activityId,
        "surface": "ios-local-ride-activity",
        "bookingId": bookingId,
      ])
    }
  }

  @objc(end:resolver:rejecter:)
  func end(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let activityId = stringValue(options, key: "activityId") ?? defaultActivityId
    notificationCenter.removePendingNotificationRequests(withIdentifiers: [activityId])
    notificationCenter.removeDeliveredNotifications(withIdentifiers: [activityId])
    resolve([
      "success": true,
      "activityId": activityId,
      "surface": "ios-local-ride-activity",
    ])
  }

  @objc(dismiss:resolver:rejecter:)
  func dismiss(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    end(options, resolver: resolve, rejecter: reject)
  }

  private func fallbackTitle(_ payload: NSDictionary) -> String {
    let status = (stringValue(payload, key: "status") ?? "").lowercased()
    let destination = stringValue(payload, key: "destinationAddress") ?? "destino"
    let driverName = stringValue(payload, key: "driverName") ?? "Motorista"

    switch status {
    case "accepted":
      return "\(driverName) está a caminho"
    case "arrived":
      return "\(driverName) chegou"
    case "started":
      return "A caminho de \(destination)"
    default:
      return "Corrida em andamento"
    }
  }

  private func subtitle(_ payload: NSDictionary) -> String {
    let vehicleParts = [
      firstString(payload, keys: ["vehicleModel", "driverVehicleModel", "carModel", "driverCarModel"]),
      firstString(payload, keys: ["vehicleColor", "driverVehicleColor", "carColor", "driverCarColor"]),
      firstString(payload, keys: ["vehiclePlate", "driverVehiclePlate", "carPlate", "driverCarPlate", "licensePlate"]),
    ].compactMap { value in
      value?.isEmpty == false ? value : nil
    }

    if !vehicleParts.isEmpty {
      return vehicleParts.joined(separator: " • ")
    }

    let driverName = stringValue(payload, key: "driverName")
    let customerName = stringValue(payload, key: "customerName")
    return driverName ?? customerName ?? "Leaf"
  }

  private func body(_ payload: NSDictionary) -> String {
    let status = (stringValue(payload, key: "status") ?? "").lowercased()
    let remainingLabel = stringValue(payload, key: "remainingLabel")
    let pickupAddress = stringValue(payload, key: "pickupAddress")
    let destinationAddress = stringValue(payload, key: "destinationAddress")
    let distance = normalizedDistance(payload)

    switch status {
    case "accepted":
      return compactLines([
        distance.map { "\($0) até seu local" },
        remainingLabel.map { "Chega em \($0)" },
        pickupAddress.map { "Embarque: \($0)" },
      ])
    case "arrived":
      return compactLines([
        "Prossiga para o embarque",
        pickupAddress.map { "Local: \($0)" },
      ])
    case "started":
      return compactLines([
        remainingLabel.map { "Chegada prevista em \($0)" },
        destinationAddress.map { "Destino: \($0)" },
      ])
    case "completed":
      let fare = stringValue(payload, key: "fare")
      return fare.map { "Valor: \($0)" } ?? "Viagem finalizada"
    default:
      return stringValue(payload, key: "body") ?? "Acompanhe sua corrida pela Leaf."
    }
  }

  private func normalizedDistance(_ payload: NSDictionary) -> String? {
    guard let raw = stringValue(payload, key: "distance"), !raw.isEmpty else {
      return nil
    }

    let lowercased = raw.lowercased()
    if lowercased.contains("km") || lowercased.contains(" m") {
      return raw
    }
    return "\(raw) km"
  }

  private func compactLines(_ lines: [String?]) -> String {
    lines.compactMap { line in
      guard let line = line?.trimmingCharacters(in: .whitespacesAndNewlines), !line.isEmpty else {
        return nil
      }
      return line
    }.joined(separator: "\n")
  }

  private func userInfo(_ payload: NSDictionary, activityId: String) -> [AnyHashable: Any] {
    var result: [AnyHashable: Any] = [
      "type": "ride_status",
      "activityId": activityId,
      "surface": "ios-local-ride-activity",
    ]

    for (key, value) in payload {
      guard let key = key as? String else { continue }
      if value is NSString || value is NSNumber || value is NSNull {
        result[key] = value
      }
    }

    return result
  }

  private func firstString(_ payload: NSDictionary, keys: [String]) -> String? {
    for key in keys {
      if let value = stringValue(payload, key: key), !value.isEmpty {
        return value
      }
    }
    return nil
  }

  private func stringValue(_ payload: NSDictionary, key: String) -> String? {
    guard let value = payload[key], !(value is NSNull) else {
      return nil
    }

    if let value = value as? String {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }

    if let value = value as? NSNumber {
      return value.stringValue
    }

    return nil
  }
}
