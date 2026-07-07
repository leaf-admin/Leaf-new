import ActivityKit
import SwiftUI
import WidgetKit

struct LeafRideActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LeafRideActivityAttributes.self) { context in
      LeafRideLockScreenView(context: context)
        .activityBackgroundTint(Color(red: 0.98, green: 0.98, blue: 0.96))
        .activitySystemActionForegroundColor(Color(red: 0.07, green: 0.19, blue: 0.04))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          LeafRideIslandMetric(label: "ETA", value: primaryMetric(context.state.etaText))
        }
        DynamicIslandExpandedRegion(.trailing) {
          LeafRideIslandMetric(label: "Dist.", value: primaryMetric(context.state.distanceText))
        }
        DynamicIslandExpandedRegion(.bottom) {
          LeafRideProgressBlock(state: context.state)
        }
      } compactLeading: {
        Image(systemName: compactIcon(for: context.state.phase))
          .foregroundStyle(Color(red: 0.07, green: 0.31, blue: 0.12))
      } compactTrailing: {
        Text(primaryMetric(context.state.etaText))
          .font(.caption2.weight(.semibold))
          .foregroundStyle(Color(red: 0.07, green: 0.19, blue: 0.04))
      } minimal: {
        Image(systemName: compactIcon(for: context.state.phase))
          .foregroundStyle(Color(red: 0.07, green: 0.31, blue: 0.12))
      }
    }
  }
}

struct LeafRideLockScreenView: View {
  let context: ActivityViewContext<LeafRideActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 3) {
          Text(context.state.title)
            .font(.headline.weight(.semibold))
            .lineLimit(1)
          if !context.state.subtitle.isEmpty {
            Text(context.state.subtitle)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 8)
        if !context.state.fareLabel.isEmpty {
          Text(context.state.fareLabel)
            .font(.headline.weight(.bold))
            .monospacedDigit()
        }
      }

      if !context.state.body.isEmpty {
        Text(context.state.body)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }

      LeafRideProgressBlock(state: context.state)
    }
    .padding(.vertical, 2)
  }
}

struct LeafRideProgressBlock: View {
  let state: LeafRideActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Capsule()
            .fill(Color(red: 0.87, green: 0.88, blue: 0.84))
          Capsule()
            .fill(progressColor(for: state.phase))
            .frame(width: max(8, proxy.size.width * state.progress))
        }
      }
      .frame(height: 6)

      HStack {
        LeafRideInlineMetric(label: "Tempo", value: state.etaText)
        Spacer(minLength: 12)
        LeafRideInlineMetric(label: "Distancia", value: state.distanceText)
      }
    }
  }
}

struct LeafRideInlineMetric: View {
  let label: String
  let value: String

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(label.uppercased())
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
      Text(value.isEmpty ? "--" : value)
        .font(.caption.weight(.semibold))
        .monospacedDigit()
    }
  }
}

struct LeafRideIslandMetric: View {
  let label: String
  let value: String

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(label)
        .font(.caption2)
        .foregroundStyle(.secondary)
      Text(value)
        .font(.caption.weight(.semibold))
        .monospacedDigit()
    }
  }
}

private func primaryMetric(_ value: String) -> String {
  value.isEmpty ? "--" : value
}

private func compactIcon(for phase: String) -> String {
  switch phase.lowercased() {
  case "accepted", "arrived":
    return "car.side.front.open"
  case "started":
    return "location.north.line"
  default:
    return "car.fill"
  }
}

private func progressColor(for phase: String) -> Color {
  switch phase.lowercased() {
  case "cancelled", "no_drivers", "rejected":
    return Color(red: 0.77, green: 0.12, blue: 0.20)
  case "completed":
    return Color(red: 0.07, green: 0.31, blue: 0.12)
  default:
    return Color(red: 0.08, green: 0.49, blue: 0.22)
  }
}
