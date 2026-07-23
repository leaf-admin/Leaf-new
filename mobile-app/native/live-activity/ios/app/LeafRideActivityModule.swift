import ActivityKit
import Foundation
import React

@objc(LeafRideActivity)
final class LeafRideActivity: NSObject {
  private var pushTokensByActivityId: [String: String] = [:]

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(isAvailable:rejecter:)
  func isAvailable(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 16.2, *) {
      let authorization = ActivityAuthorizationInfo()
      resolve([
        "available": authorization.areActivitiesEnabled,
        "surface": "ios_activitykit",
      ])
      return
    }

    resolve([
      "available": false,
      "reason": "IOS_ACTIVITYKIT_UNAVAILABLE",
      "surface": "ios_activitykit",
    ])
  }

  @objc(startOrUpdate:resolver:rejecter:)
  func startOrUpdate(
    _ payload: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.2, *) else {
      resolve([
        "success": false,
        "skipped": true,
        "reason": "IOS_ACTIVITYKIT_UNAVAILABLE",
        "surface": "ios_activitykit",
      ])
      return
    }

    Task {
      do {
        let attributes = attributesFromPayload(payload)
        let state = contentStateFromPayload(payload)
        let activityContent = ActivityContent(state: state, staleDate: staleDateFromPayload(payload))
        let existing = Self.activity(with: attributes.activityId)
        let activity: Activity<LeafRideActivityAttributes>

        if let existing {
          await existing.update(activityContent)
          activity = existing
        } else {
          activity = try Activity<LeafRideActivityAttributes>.request(
            attributes: attributes,
            content: activityContent,
            pushType: .token
          )
        }

        let pushToken = await pushToken(for: activity, activityId: attributes.activityId)
        if let pushToken, !pushToken.isEmpty {
          pushTokensByActivityId[attributes.activityId] = pushToken
        }

        resolve([
          "success": true,
          "activityId": attributes.activityId,
          "rideId": attributes.rideId,
          "bookingId": attributes.bookingId,
          "surface": "ios_activitykit",
          "pushToken": pushTokensByActivityId[attributes.activityId] ?? "",
        ])
      } catch {
        reject(
          "LEAF_RIDE_ACTIVITY_UPDATE_FAILED",
          "Could not start or update the ride Live Activity.",
          error
        )
      }
    }
  }

  @objc(end:resolver:rejecter:)
  func end(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.2, *) else {
      resolve([
        "success": true,
        "skipped": true,
        "reason": "IOS_ACTIVITYKIT_UNAVAILABLE",
        "surface": "ios_activitykit",
      ])
      return
    }

    Task {
      let activityId = stringValue(options, key: "activityId")
      let activities = Self.activities(matching: activityId)
      let endedAt = dateFromPayload(options, key: "endedAt") ?? Date()

      for activity in activities {
        let state = contentStateFromPayload(options, endedAt: endedAt)
        let content = ActivityContent(state: state, staleDate: endedAt)
        await activity.end(content, dismissalPolicy: .immediate)
        pushTokensByActivityId.removeValue(forKey: activity.attributes.activityId)
      }

      resolve([
        "success": true,
        "activityId": activityId ?? "",
        "endedCount": activities.count,
        "surface": "ios_activitykit",
      ])
    }
  }

  @objc(dismiss:resolver:rejecter:)
  func dismiss(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    end(options, resolver: resolve, rejecter: reject)
  }

  @available(iOS 16.2, *)
  private static func activity(with activityId: String) -> Activity<LeafRideActivityAttributes>? {
    Activity<LeafRideActivityAttributes>.activities.first {
      $0.attributes.activityId == activityId
    }
  }

  @available(iOS 16.2, *)
  private static func activities(matching activityId: String?) -> [Activity<LeafRideActivityAttributes>] {
    guard let activityId, !activityId.isEmpty else {
      return Array(Activity<LeafRideActivityAttributes>.activities)
    }
    return Activity<LeafRideActivityAttributes>.activities.filter {
      $0.attributes.activityId == activityId
    }
  }

  @available(iOS 16.2, *)
  private func attributesFromPayload(_ payload: NSDictionary) -> LeafRideActivityAttributes {
    let rideId = firstString(payload, keys: ["rideId", "bookingId", "tripId"])
    let role = stringValue(payload, key: "role") ?? "passenger"
    let activityId = stringValue(payload, key: "activityId") ?? "ride:\(role):\(rideId)"
    let bookingId = firstString(payload, keys: ["bookingId", "rideId", "tripId"])

    return LeafRideActivityAttributes(
      activityId: activityId,
      rideId: rideId,
      bookingId: bookingId,
      role: role
    )
  }

  @available(iOS 16.2, *)
  private func contentStateFromPayload(
    _ payload: NSDictionary,
    endedAt: Date? = nil
  ) -> LeafRideActivityAttributes.ContentState {
    LeafRideActivityAttributes.ContentState(
      title: stringValue(payload, key: "title") ?? "Corrida ativa",
      subtitle: stringValue(payload, key: "subtitle") ?? "",
      body: stringValue(payload, key: "body") ?? "Acompanhe a corrida pela Leaf.",
      phase: stringValue(payload, key: "phase") ?? stringValue(payload, key: "status") ?? "accepted",
      etaText: stringValue(payload, key: "etaText") ?? "",
      distanceText: stringValue(payload, key: "distanceText") ?? "",
      fareLabel: stringValue(payload, key: "fareLabel") ?? "",
      progress: doubleValue(payload, key: "progress") ?? 0,
      updatedAt: endedAt ?? dateFromPayload(payload, key: "updatedAt") ?? Date()
    )
  }

  private func staleDateFromPayload(_ payload: NSDictionary) -> Date? {
    dateFromPayload(payload, key: "staleAt")
  }

  private func pushToken(
    for activity: Activity<LeafRideActivityAttributes>,
    activityId: String
  ) async -> String? {
    if let cached = pushTokensByActivityId[activityId], !cached.isEmpty {
      return cached
    }

    return await withTaskGroup(of: String?.self) { group in
      group.addTask {
        for await data in activity.pushTokenUpdates {
          return data.map { String(format: "%02x", $0) }.joined()
        }
        return nil
      }

      group.addTask {
        try? await Task.sleep(nanoseconds: 600_000_000)
        return nil
      }

      let value = await group.next() ?? nil
      group.cancelAll()
      return value
    }
  }

  private func firstString(_ payload: NSDictionary, keys: [String]) -> String {
    for key in keys {
      if let value = stringValue(payload, key: key), !value.isEmpty {
        return value
      }
    }
    return ""
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

  private func doubleValue(_ payload: NSDictionary, key: String) -> Double? {
    guard let value = payload[key], !(value is NSNull) else {
      return nil
    }

    if let value = value as? NSNumber {
      return min(1.0, max(0.0, value.doubleValue))
    }

    if let value = value as? String, let parsed = Double(value) {
      return min(1.0, max(0.0, parsed))
    }

    return nil
  }

  private func dateFromPayload(_ payload: NSDictionary, key: String) -> Date? {
    guard let raw = stringValue(payload, key: key) else {
      return nil
    }

    let formatter = ISO8601DateFormatter()
    return formatter.date(from: raw)
  }
}
