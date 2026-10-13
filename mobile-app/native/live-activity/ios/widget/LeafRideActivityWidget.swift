import ActivityKit
import SwiftUI
import WidgetKit

// Leaf palette, kept local: the widget target does not share the app's assets.
private enum LeafTone {
  static let ink = Color(red: 0.07, green: 0.13, blue: 0.05)
  static let leaf = Color(red: 0.10, green: 0.20, blue: 0.05)
  static let lime = Color(red: 0.83, green: 0.91, blue: 0.29)
  static let paper = Color(red: 0.98, green: 0.98, blue: 0.96)
  static let track = Color(red: 0.87, green: 0.89, blue: 0.84)
  static let danger = Color(red: 0.77, green: 0.12, blue: 0.20)
}

struct LeafRideActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LeafRideActivityAttributes.self) { context in
      LeafRideLockScreenView(state: context.state)
        .activityBackgroundTint(LeafTone.paper)
        .activitySystemActionForegroundColor(LeafTone.ink)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          LeafRidePhaseBadge(phase: context.state.phase, onDark: true)
            .padding(.leading, 2)
        }
        DynamicIslandExpandedRegion(.trailing) {
          LeafRideEtaLabel(state: context.state, onDark: true)
            .padding(.trailing, 2)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.title)
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            LeafRideTrack(state: context.state, onDark: true)
            if !leafRideSupportingLine(context.state).isEmpty {
              Text(leafRideSupportingLine(context.state))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
          }
          .padding(.top, 2)
        }
      } compactLeading: {
        Image(systemName: leafRideIcon(for: context.state.phase))
          .font(.caption.weight(.semibold))
          .foregroundStyle(LeafTone.lime)
      } compactTrailing: {
        Text(leafRideCompactMetric(context.state))
          .font(.caption2.weight(.semibold))
          .monospacedDigit()
          .contentTransition(.numericText())
          .foregroundStyle(LeafTone.lime)
      } minimal: {
        // The ring is the whole message in the smallest form: how far along the ride is.
        ZStack {
          Circle()
            .stroke(Color.white.opacity(0.22), lineWidth: 2.5)
          Circle()
            .trim(from: 0, to: max(0.04, leafRideTrackProgress(context.state)))
            .stroke(LeafTone.lime, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            .rotationEffect(.degrees(-90))
        }
        .padding(2)
      }
      .keylineTint(LeafTone.lime)
    }
  }
}

struct LeafRideLockScreenView: View {
  let state: LeafRideActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .center, spacing: 10) {
        LeafRidePhaseBadge(phase: state.phase, onDark: false)
        Spacer(minLength: 8)
        LeafRideEtaLabel(state: state, onDark: false)
      }

      VStack(alignment: .leading, spacing: 2) {
        Text(state.title)
          .font(.headline.weight(.semibold))
          .foregroundStyle(LeafTone.ink)
          .lineLimit(1)
          .minimumScaleFactor(0.85)
        if !state.subtitle.isEmpty {
          Text(state.subtitle)
            .font(.subheadline)
            .foregroundStyle(LeafTone.ink.opacity(0.62))
            .lineLimit(1)
        }
      }

      LeafRideTrack(state: state, onDark: false)

      HStack(alignment: .firstTextBaseline) {
        Text(leafRideSupportingLine(state))
          .font(.footnote)
          .foregroundStyle(LeafTone.ink.opacity(0.62))
          .lineLimit(1)
        Spacer(minLength: 8)
        if !state.fareLabel.isEmpty {
          Text(state.fareLabel)
            .font(.footnote.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(LeafTone.ink)
        }
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
  }
}

// Phase chip: one glyph and one word, so the state reads without the title.
struct LeafRidePhaseBadge: View {
  let phase: String
  let onDark: Bool

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: leafRideIcon(for: phase))
        .font(.caption.weight(.semibold))
      Text(leafRidePhaseWord(for: phase))
        .font(.caption.weight(.semibold))
        .lineLimit(1)
    }
    .foregroundStyle(foreground)
    .padding(.horizontal, 9)
    .padding(.vertical, 5)
    .background(Capsule().fill(background))
  }

  private var isProblem: Bool { leafRideIsProblem(phase) }
  private var foreground: Color {
    if isProblem { return onDark ? .white : LeafTone.danger }
    return onDark ? LeafTone.lime : LeafTone.leaf
  }
  private var background: Color {
    if isProblem { return LeafTone.danger.opacity(onDark ? 0.55 : 0.12) }
    return onDark ? Color.white.opacity(0.14) : LeafTone.leaf.opacity(0.09)
  }
}

// The number people look for. It rolls instead of jumping when the estimate changes.
struct LeafRideEtaLabel: View {
  let state: LeafRideActivityAttributes.ContentState
  let onDark: Bool

  var body: some View {
    let parts = leafRideEtaParts(state.etaText)
    // No estimate (driver at the door, ride cancelled): say nothing instead of "--".
    HStack(alignment: .firstTextBaseline, spacing: 3) {
      Text(parts.value == "--" ? "" : parts.value)
        .font(.system(.title2, design: .rounded).weight(.bold))
        .monospacedDigit()
        .contentTransition(.numericText())
      if !parts.unit.isEmpty {
        Text(parts.unit)
          .font(.caption.weight(.semibold))
          .opacity(0.7)
      }
    }
    .foregroundStyle(onDark ? Color.white : LeafTone.ink)
    .animation(.spring(response: 0.45, dampingFraction: 0.85), value: state.etaText)
  }
}

// Route as a line: origin dot, the car where the ride is, destination pin.
struct LeafRideTrack: View {
  let state: LeafRideActivityAttributes.ContentState
  let onDark: Bool

  private let carSize: CGFloat = 22

  var body: some View {
    GeometryReader { proxy in
      let usable = max(0, proxy.size.width - carSize)
      let progress = CGFloat(leafRideTrackProgress(state))
      let carX = usable * progress

      ZStack(alignment: .leading) {
        Capsule()
          .fill(onDark ? Color.white.opacity(0.18) : LeafTone.track)
          .frame(height: 5)
          .padding(.horizontal, carSize / 2)

        Capsule()
          .fill(
            LinearGradient(
              colors: fillColors,
              startPoint: .leading,
              endPoint: .trailing
            )
          )
          .frame(width: max(5, carX), height: 5)
          .padding(.leading, carSize / 2)

        Circle()
          .fill(fillColors.first ?? LeafTone.leaf)
          .frame(width: 8, height: 8)
          .padding(.leading, carSize / 2 - 4)

        Image(systemName: "mappin.circle.fill")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(onDark ? Color.white.opacity(0.8) : LeafTone.ink.opacity(0.55))
          .frame(maxWidth: .infinity, alignment: .trailing)
          .opacity(progress > 0.93 ? 0 : 1)

        ZStack {
          Circle()
            .fill(leafRideIsProblem(state.phase) ? LeafTone.danger : (onDark ? LeafTone.lime : LeafTone.leaf))
          Image(systemName: leafRideIsProblem(state.phase) ? "xmark" : "car.fill")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(leafRideIsProblem(state.phase) || !onDark ? Color.white : LeafTone.ink)
        }
        .frame(width: carSize, height: carSize)
        .shadow(color: Color.black.opacity(onDark ? 0 : 0.16), radius: 3, y: 1)
        .offset(x: carX)
      }
      .frame(height: carSize)
      .animation(.spring(response: 0.7, dampingFraction: 0.88), value: state.progress)
    }
    .frame(height: carSize)
  }

  private var fillColors: [Color] {
    if leafRideIsProblem(state.phase) {
      return [LeafTone.danger.opacity(0.6), LeafTone.danger]
    }
    return onDark
      ? [LeafTone.lime.opacity(0.55), LeafTone.lime]
      : [LeafTone.leaf.opacity(0.55), LeafTone.leaf]
  }
}

// The track is the current leg: to the pickup, then to the destination. Once the driver
// is at the pickup (or the ride is over) the car is at the end, whatever number arrived.
private func leafRideTrackProgress(_ state: LeafRideActivityAttributes.ContentState) -> Double {
  switch state.phase.lowercased() {
  case "arrived", "completed", "complete":
    return 1
  default:
    return min(1, max(0, state.progress))
  }
}

private func leafRideIsProblem(_ phase: String) -> Bool {
  switch phase.lowercased() {
  case "cancelled", "canceled", "no_drivers", "rejected":
    return true
  default:
    return false
  }
}

private func leafRideIcon(for phase: String) -> String {
  switch phase.lowercased() {
  case "searching", "pending":
    return "magnifyingglass"
  case "accepted":
    return "car.fill"
  case "arrived":
    return "figure.wave"
  case "started":
    return "location.north.fill"
  case "completed":
    return "checkmark"
  case "cancelled", "canceled", "no_drivers", "rejected":
    return "xmark"
  default:
    return "car.fill"
  }
}

private func leafRidePhaseWord(for phase: String) -> String {
  switch phase.lowercased() {
  case "searching", "pending":
    return "Buscando"
  case "accepted":
    return "A caminho"
  case "arrived":
    return "No local"
  case "started":
    return "Em viagem"
  case "completed":
    return "Concluída"
  case "cancelled", "canceled":
    return "Cancelada"
  case "no_drivers", "rejected":
    return "Sem motorista"
  default:
    return "Leaf"
  }
}

// "4 min" -> ("4", "min"); anything else is shown whole.
private func leafRideEtaParts(_ text: String) -> (value: String, unit: String) {
  let trimmed = text.trimmingCharacters(in: .whitespaces)
  guard !trimmed.isEmpty else { return ("--", "") }
  let pieces = trimmed.split(separator: " ", maxSplits: 1).map(String.init)
  if pieces.count == 2, pieces[0].first?.isNumber == true {
    return (pieces[0], pieces[1])
  }
  return (trimmed, "")
}

private func leafRideCompactMetric(_ state: LeafRideActivityAttributes.ContentState) -> String {
  let parts = leafRideEtaParts(state.etaText)
  if parts.value == "--" {
    return state.distanceText.isEmpty ? "Leaf" : state.distanceText
  }
  return parts.unit.isEmpty ? parts.value : "\(parts.value) \(parts.unit)"
}

// One quiet line under the track: where to, and how far.
private func leafRideSupportingLine(_ state: LeafRideActivityAttributes.ContentState) -> String {
  if state.distanceText.isEmpty { return state.body }
  if state.body.isEmpty { return state.distanceText }
  return "\(state.distanceText) · \(state.body)"
}
