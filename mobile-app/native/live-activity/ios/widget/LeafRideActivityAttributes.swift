import ActivityKit
import Foundation

public struct LeafRideActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var title: String
    public var subtitle: String
    public var body: String
    public var phase: String
    public var etaText: String
    public var distanceText: String
    public var fareLabel: String
    public var progress: Double
    public var updatedAt: Date

    public init(
      title: String,
      subtitle: String,
      body: String,
      phase: String,
      etaText: String,
      distanceText: String,
      fareLabel: String,
      progress: Double,
      updatedAt: Date
    ) {
      self.title = title
      self.subtitle = subtitle
      self.body = body
      self.phase = phase
      self.etaText = etaText
      self.distanceText = distanceText
      self.fareLabel = fareLabel
      self.progress = min(1.0, max(0.0, progress))
      self.updatedAt = updatedAt
    }
  }

  public var activityId: String
  public var rideId: String
  public var bookingId: String
  public var role: String

  public init(activityId: String, rideId: String, bookingId: String, role: String) {
    self.activityId = activityId
    self.rideId = rideId
    self.bookingId = bookingId
    self.role = role
  }
}
