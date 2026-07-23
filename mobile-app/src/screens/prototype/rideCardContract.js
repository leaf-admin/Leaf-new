export const RIDE_CARD_ROLES = Object.freeze({
  PASSENGER: "passenger",
  DRIVER: "driver",
});

export const RIDE_CARD_PRIORITIES = Object.freeze({
  CRITICAL: "critical",
  IMPORTANT: "important",
  CONTEXTUAL: "contextual",
});

export const RIDE_CARD_STATES = Object.freeze({
  PASSENGER_HOME: "passenger_home",
  PASSENGER_DESTINATION_ENTRY: "passenger_destination_entry",
  PASSENGER_QUOTE_REVIEW: "passenger_quote_review",
  PASSENGER_PIX_PAYMENT: "passenger_pix_payment",
  PASSENGER_SEARCHING: "passenger_searching",
  PASSENGER_NO_DRIVERS: "passenger_no_drivers",
  PASSENGER_DRIVER_ACCEPTED: "passenger_driver_accepted",
  PASSENGER_DRIVER_ARRIVED: "passenger_driver_arrived",
  PASSENGER_IN_TRIP: "passenger_in_trip",
  PASSENGER_OPERATIONAL_INTERRUPTED: "passenger_operational_interrupted",
  PASSENGER_SEARCHING_REPLACEMENT: "passenger_searching_replacement",
  PASSENGER_COMPLETED: "passenger_completed",
  PASSENGER_RATING: "passenger_rating",
  PASSENGER_CANCELLATION: "passenger_cancellation",
  PASSENGER_SHARE_TRIP: "passenger_share_trip",
  DRIVER_HOME_OFFLINE: "driver_home_offline",
  DRIVER_HOME_ONLINE: "driver_home_online",
  DRIVER_NEW_OFFER: "driver_new_offer",
  DRIVER_TO_PICKUP: "driver_to_pickup",
  DRIVER_AT_PICKUP: "driver_at_pickup",
  DRIVER_IN_TRIP: "driver_in_trip",
  DRIVER_OPERATIONAL_INTERRUPTED: "driver_operational_interrupted",
  DRIVER_COMPLETED_SUMMARY: "driver_completed_summary",
  DRIVER_DESTINATION_MODE: "driver_destination_mode",
  DRIVER_BLOCKED: "driver_blocked",
});

const FIELD_SOURCES = Object.freeze({
  runtime: "prototypeRideRuntime",
  booking: "activeBooking",
  driver: "driverInfo",
  vehicle: "driverInfo.vehicle",
  pricing: "pricingSnapshot",
  payment: "paymentState",
  route: "routeProgress",
  profile: "profile",
  support: "support",
  local: "localUiState",
});

function field(id, label, priority, source, notes = "") {
  return Object.freeze({
    id,
    label,
    priority,
    source,
    required: priority !== RIDE_CARD_PRIORITIES.CONTEXTUAL,
    notes,
  });
}

function critical(id, label, source, notes = "") {
  return field(id, label, RIDE_CARD_PRIORITIES.CRITICAL, source, notes);
}

function important(id, label, source, notes = "") {
  return field(id, label, RIDE_CARD_PRIORITIES.IMPORTANT, source, notes);
}

function contextual(id, label, source, notes = "") {
  return field(id, label, RIDE_CARD_PRIORITIES.CONTEXTUAL, source, notes);
}

function contract({ role, state, title, goal, fields, copyGuards = [], visualGuards = [] }) {
  return Object.freeze({
    role,
    state,
    title,
    goal,
    fields: Object.freeze(fields),
    copyGuards: Object.freeze(copyGuards),
    visualGuards: Object.freeze(visualGuards),
  });
}

const passengerContracts = Object.freeze({
  [RIDE_CARD_STATES.PASSENGER_HOME]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_HOME,
    title: "Passenger home card",
    goal: "Start a ride without losing pickup context.",
    fields: [
      critical("pickup_address", "Pickup street and number", FIELD_SOURCES.runtime),
      critical("destination_cta", "Destination entry CTA", FIELD_SOURCES.local),
      important("profile_entry", "Profile or menu access", FIELD_SOURCES.profile),
      important("vehicle_default", "Default ride category", FIELD_SOURCES.booking),
      contextual("recent_destinations", "Recent destinations after opening destination modal", FIELD_SOURCES.runtime, "Show only inside destination entry and cap at 3 visible results."),
    ],
    visualGuards: [
      "Initial passenger and driver home can be floating cards.",
      "Do not show recent destinations on the closed home card.",
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_DESTINATION_ENTRY]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_DESTINATION_ENTRY,
    title: "Passenger destination entry",
    goal: "Let the passenger confirm origin before price calculation.",
    fields: [
      critical("pickup_address", "Pickup street and number", FIELD_SOURCES.runtime),
      critical("pickup_edit_action", "Change pickup action", FIELD_SOURCES.local),
      critical("destination_input", "Destination input", FIELD_SOURCES.local),
      important("destination_suggestions", "Destination suggestions", FIELD_SOURCES.runtime),
      contextual("recent_destinations", "Recent destinations", FIELD_SOURCES.runtime, "Maximum 3 visible results."),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_QUOTE_REVIEW]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_QUOTE_REVIEW,
    title: "Passenger quote review",
    goal: "Confirm fare, route and payment before PIX.",
    fields: [
      critical("pickup_address", "Pickup address", FIELD_SOURCES.booking),
      critical("destination_address", "Destination address", FIELD_SOURCES.booking),
      critical("fare", "Fare", FIELD_SOURCES.pricing),
      critical("payment_method", "Payment method", FIELD_SOURCES.payment),
      important("vehicle_type", "Ride category", FIELD_SOURCES.booking),
      important("distance", "Estimated distance", FIELD_SOURCES.route),
      important("duration", "Estimated duration", FIELD_SOURCES.route),
      contextual("ride_preferences_entry", "Comfort preferences entry", FIELD_SOURCES.local, "Can move to the 5-second preference sheet after PIX confirmation."),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_PIX_PAYMENT]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_PIX_PAYMENT,
    title: "Passenger PIX payment",
    goal: "Make payment status and next step obvious.",
    fields: [
      critical("fare", "PIX amount", FIELD_SOURCES.payment),
      critical("qr_code", "QR code", FIELD_SOURCES.payment),
      critical("pix_copy_code", "Copy and paste code", FIELD_SOURCES.payment),
      critical("expiry_timer", "Payment expiry timer", FIELD_SOURCES.payment),
      important("payment_status", "Payment status", FIELD_SOURCES.payment),
      important("trip_summary", "Origin, destination and category summary", FIELD_SOURCES.booking),
      contextual("ride_preferences_quick_sheet", "Quick comfort preference sheet", FIELD_SOURCES.local, "Use after payment before search, with a short timeout."),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_SEARCHING]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_SEARCHING,
    title: "Passenger searching",
    goal: "Show that the fare is protected while search progresses.",
    fields: [
      critical("search_status", "Search status", FIELD_SOURCES.runtime),
      critical("protected_fare", "Protected fare", FIELD_SOURCES.pricing),
      critical("pickup_address", "Pickup address", FIELD_SOURCES.booking),
      critical("destination_address", "Destination address", FIELD_SOURCES.booking),
      important("search_radius", "Current search radius", FIELD_SOURCES.runtime),
      important("elapsed_time", "Elapsed search time", FIELD_SOURCES.runtime),
      important("vehicle_type", "Ride category", FIELD_SOURCES.booking),
      critical("cancel_search_action", "Cancel search action", FIELD_SOURCES.local),
    ],
    copyGuards: [
      "Do not repeat waiting/searching copy in more than one prominent block.",
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_NO_DRIVERS]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_NO_DRIVERS,
    title: "Passenger no drivers",
    goal: "Explain what happened and protect payment trust.",
    fields: [
      critical("no_driver_status", "No drivers status", FIELD_SOURCES.runtime),
      critical("refund_or_hold_status", "PIX hold/refund status", FIELD_SOURCES.payment),
      critical("retry_action", "Try again action", FIELD_SOURCES.local),
      important("change_destination_action", "Change route action", FIELD_SOURCES.local),
      important("support_action", "Support action", FIELD_SOURCES.support),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
    title: "Passenger driver accepted",
    goal: "Help the passenger identify the driver and prepare for pickup.",
    fields: [
      critical("driver_name", "Driver name", FIELD_SOURCES.driver),
      critical("driver_photo", "Driver photo or avatar", FIELD_SOURCES.driver),
      critical("driver_rating", "Driver rating", FIELD_SOURCES.driver),
      critical("vehicle_model", "Vehicle model", FIELD_SOURCES.vehicle),
      critical("vehicle_color", "Vehicle color", FIELD_SOURCES.vehicle, "Use fallback copy only if the backend does not provide color yet."),
      critical("vehicle_plate", "Vehicle plate", FIELD_SOURCES.vehicle),
      critical("pickup_eta", "ETA to pickup", FIELD_SOURCES.route),
      important("pickup_distance", "Distance to pickup", FIELD_SOURCES.route),
      critical("pickup_address", "Pickup address", FIELD_SOURCES.booking),
      critical("destination_address", "Destination", FIELD_SOURCES.booking),
      important("fare", "Fare", FIELD_SOURCES.pricing),
      important("vehicle_type", "Ride category", FIELD_SOURCES.booking),
      critical("contact_actions", "Call and message actions", FIELD_SOURCES.local),
      important("share_trip_action", "Share trip action", FIELD_SOURCES.local, "Keep available in the expanded arrival options instead of competing with driver identity and ETA."),
      critical("safety_action", "Safety/SOS action", FIELD_SOURCES.local),
      important("cancel_action", "Cancel ride action", FIELD_SOURCES.local),
    ],
    visualGuards: [
      "Driver identity and vehicle plate must not be visually secondary.",
      "Fare must never use red unless it is debt, error or risk.",
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_DRIVER_ARRIVED]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_DRIVER_ARRIVED,
    title: "Passenger driver arrived",
    goal: "Make pickup urgent without creating repeated waiting copy.",
    fields: [
      critical("driver_name", "Driver name", FIELD_SOURCES.driver),
      critical("driver_photo", "Driver photo or avatar", FIELD_SOURCES.driver),
      critical("vehicle_model", "Vehicle model", FIELD_SOURCES.vehicle),
      critical("vehicle_color", "Vehicle color", FIELD_SOURCES.vehicle),
      critical("vehicle_plate", "Vehicle plate", FIELD_SOURCES.vehicle),
      critical("boarding_timer", "Boarding countdown", FIELD_SOURCES.runtime),
      critical("boarding_timer_message", "Timer state message", FIELD_SOURCES.runtime),
      critical("pickup_address", "Pickup address", FIELD_SOURCES.booking),
      critical("contact_actions", "Call and message actions", FIELD_SOURCES.local),
      critical("safety_action", "Safety/SOS action", FIELD_SOURCES.local),
      important("cancel_action", "Cancel ride action", FIELD_SOURCES.local),
    ],
    copyGuards: [
      "Use one timer message: normal, urgent or fee-risk. Do not repeat waiting language.",
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_IN_TRIP]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_IN_TRIP,
    title: "Passenger in trip",
    goal: "Show route progress and let the passenger manage safety/share/support.",
    fields: [
      critical("destination_address", "Destination", FIELD_SOURCES.booking),
      critical("eta_final", "Final ETA", FIELD_SOURCES.route),
      critical("distance_remaining", "Distance remaining", FIELD_SOURCES.route),
      critical("route_progress", "Route progress", FIELD_SOURCES.route),
      critical("driver_name", "Driver name", FIELD_SOURCES.driver),
      critical("driver_photo", "Driver photo or avatar", FIELD_SOURCES.driver),
      critical("vehicle_model", "Vehicle model", FIELD_SOURCES.vehicle),
      critical("vehicle_plate", "Vehicle plate", FIELD_SOURCES.vehicle),
      important("fare", "Fare", FIELD_SOURCES.pricing),
      important("vehicle_type", "Ride category", FIELD_SOURCES.booking),
      important("share_trip_action", "Share trip action", FIELD_SOURCES.local, "Keep available in the expanded trip options instead of competing with route progress."),
      critical("safety_action", "Safety/SOS action", FIELD_SOURCES.local),
      critical("support_action", "Support action", FIELD_SOURCES.support),
      contextual("change_destination_action", "Change destination action", FIELD_SOURCES.local),
      contextual("end_early_action", "End trip early action", FIELD_SOURCES.local),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_OPERATIONAL_INTERRUPTED]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_OPERATIONAL_INTERRUPTED,
    title: "Passenger operational interruption",
    goal: "Let the passenger decide whether to continue or end safely.",
    fields: [
      critical("interruption_reason", "Interruption reason", FIELD_SOURCES.runtime),
      critical("current_location", "Current location", FIELD_SOURCES.route),
      critical("continue_with_other_driver_action", "Continue with another driver", FIELD_SOURCES.local),
      critical("end_here_action", "End here action", FIELD_SOURCES.local),
      important("refund_estimate", "Estimated refund", FIELD_SOURCES.payment),
      important("reserved_amount", "Reserved amount", FIELD_SOURCES.payment),
      critical("support_action", "Support action", FIELD_SOURCES.support),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_SEARCHING_REPLACEMENT]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_SEARCHING_REPLACEMENT,
    title: "Passenger searching replacement",
    goal: "Preserve trust while continuity is being matched.",
    fields: [
      critical("replacement_search_status", "Replacement search status", FIELD_SOURCES.runtime),
      critical("restart_location", "Restart location", FIELD_SOURCES.route),
      important("protected_fare_or_balance", "Protected balance/fare", FIELD_SOURCES.payment),
      critical("support_action", "Support action", FIELD_SOURCES.support),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_COMPLETED]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_COMPLETED,
    title: "Passenger completed receipt",
    goal: "Close the ride with receipt, route and rating path.",
    fields: [
      critical("final_fare", "Final fare", FIELD_SOURCES.pricing),
      critical("payment_status", "Payment status", FIELD_SOURCES.payment),
      critical("pickup_address", "Pickup address", FIELD_SOURCES.booking),
      critical("destination_address", "Destination address", FIELD_SOURCES.booking),
      important("driver_name", "Driver name", FIELD_SOURCES.driver),
      important("vehicle_plate", "Vehicle plate", FIELD_SOURCES.vehicle),
      critical("rating_action", "Rate trip action", FIELD_SOURCES.local),
      important("receipt_action", "Receipt action", FIELD_SOURCES.local),
      important("support_action", "Support action", FIELD_SOURCES.support),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_RATING]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_RATING,
    title: "Passenger rating",
    goal: "Capture feedback with minimum friction.",
    fields: [
      critical("driver_name", "Driver name", FIELD_SOURCES.driver),
      critical("rating_input", "Rating input", FIELD_SOURCES.local),
      important("rating_tags", "Rating tags", FIELD_SOURCES.local),
      contextual("rating_comment", "Optional comment", FIELD_SOURCES.local),
      important("receipt_context", "Trip receipt context", FIELD_SOURCES.booking),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_CANCELLATION]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_CANCELLATION,
    title: "Passenger cancellation",
    goal: "Make cancellation impact explicit before confirmation.",
    fields: [
      critical("reason_options", "Cancellation reasons", FIELD_SOURCES.local),
      critical("fee_or_refund_impact", "Fee or refund impact", FIELD_SOURCES.payment),
      critical("confirm_cancel_action", "Confirm cancellation", FIELD_SOURCES.local),
      important("keep_trip_action", "Keep trip action", FIELD_SOURCES.local),
      important("support_action", "Support action", FIELD_SOURCES.support),
    ],
  }),
  [RIDE_CARD_STATES.PASSENGER_SHARE_TRIP]: contract({
    role: RIDE_CARD_ROLES.PASSENGER,
    state: RIDE_CARD_STATES.PASSENGER_SHARE_TRIP,
    title: "Passenger share trip",
    goal: "Give the passenger a clear public tracking link.",
    fields: [
      critical("public_tracking_link", "Public tracking link", FIELD_SOURCES.booking),
      critical("copy_link_action", "Copy link action", FIELD_SOURCES.local),
      critical("whatsapp_action", "WhatsApp share action", FIELD_SOURCES.local),
      important("opened_count", "Open count", FIELD_SOURCES.runtime),
      important("public_preview", "Public preview action", FIELD_SOURCES.local),
      important("driver_vehicle_summary", "Driver and vehicle summary", FIELD_SOURCES.driver),
    ],
  }),
});

const driverContracts = Object.freeze({
  [RIDE_CARD_STATES.DRIVER_HOME_OFFLINE]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_HOME_OFFLINE,
    title: "Driver home offline",
    goal: "Show readiness, earnings and controls before going online.",
    fields: [
      critical("online_toggle_state", "Online toggle state", FIELD_SOURCES.runtime),
      critical("today_net_earnings", "Today net earnings", FIELD_SOURCES.pricing),
      important("daily_goal_progress", "Daily goal progress", FIELD_SOURCES.runtime),
      important("today_trip_count", "Today trip count", FIELD_SOURCES.runtime),
      important("online_time", "Online time", FIELD_SOURCES.runtime),
      important("preferences_action", "Preferences gear action", FIELD_SOURCES.local),
      contextual("destination_mode_entry", "Destination mode entry", FIELD_SOURCES.local),
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_HOME_ONLINE]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_HOME_ONLINE,
    title: "Driver home online",
    goal: "Confirm active availability without distracting from incoming offers.",
    fields: [
      critical("online_toggle_state", "Online toggle state", FIELD_SOURCES.runtime),
      critical("online_since", "Online since", FIELD_SOURCES.runtime),
      critical("today_net_earnings", "Today net earnings", FIELD_SOURCES.pricing),
      important("daily_goal_progress", "Daily goal progress", FIELD_SOURCES.runtime),
      important("today_trip_count", "Today trip count", FIELD_SOURCES.runtime),
      important("online_time", "Online time", FIELD_SOURCES.runtime),
      important("preferences_action", "Preferences gear action", FIELD_SOURCES.local),
      contextual("destination_mode_status", "Destination mode status", FIELD_SOURCES.runtime),
    ],
    visualGuards: [
      "Area demand belongs to smart push or map layer, not the primary driver card.",
      "Safety center belongs to menu/support, not the primary driver card.",
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_NEW_OFFER]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_NEW_OFFER,
    title: "Driver new offer",
    goal: "Let the driver decide quickly with enough trip economics and route context.",
    fields: [
      critical("net_payout", "Driver net payout", FIELD_SOURCES.pricing),
      important("gross_fare", "Passenger fare", FIELD_SOURCES.pricing),
      critical("pickup_address", "Pickup address", FIELD_SOURCES.booking),
      critical("destination_address", "Destination address", FIELD_SOURCES.booking),
      critical("pickup_eta", "ETA to pickup", FIELD_SOURCES.route),
      critical("pickup_distance", "Distance to pickup", FIELD_SOURCES.route),
      critical("trip_distance", "Trip distance", FIELD_SOURCES.route),
      critical("trip_duration", "Trip duration", FIELD_SOURCES.route),
      critical("passenger_name", "Passenger name", FIELD_SOURCES.profile),
      important("passenger_photo", "Passenger photo or avatar", FIELD_SOURCES.profile),
      important("passenger_rating", "Passenger rating", FIELD_SOURCES.profile),
      important("passenger_verified_badge", "Passenger verified badge", FIELD_SOURCES.profile),
      important("ride_preferences", "Temperature and sound preferences", FIELD_SOURCES.booking),
      critical("payment_confirmed", "Payment confirmed status", FIELD_SOURCES.payment),
      critical("response_timer", "Response timer", FIELD_SOURCES.runtime),
      critical("accept_action", "Accept action", FIELD_SOURCES.local),
      critical("reject_action", "Reject action", FIELD_SOURCES.local),
    ],
    visualGuards: [
      "Net payout must use positive/neutral color, never red.",
      "Offer card must expose pickup and destination at a glance.",
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_TO_PICKUP]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_TO_PICKUP,
    title: "Driver to pickup",
    goal: "Get the driver to the exact pickup point with passenger context.",
    fields: [
      critical("passenger_name", "Passenger name", FIELD_SOURCES.profile),
      critical("passenger_photo", "Passenger photo or avatar", FIELD_SOURCES.profile),
      critical("pickup_address", "Exact pickup address", FIELD_SOURCES.booking),
      critical("pickup_eta", "ETA to pickup", FIELD_SOURCES.route),
      important("pickup_distance", "Distance to pickup", FIELD_SOURCES.route),
      important("destination_preview", "Destination preview", FIELD_SOURCES.booking),
      important("ride_preferences", "Passenger ride preferences", FIELD_SOURCES.booking),
      critical("navigation_action", "Navigation action", FIELD_SOURCES.local),
      critical("contact_actions", "Call/chat actions", FIELD_SOURCES.local),
      critical("arrived_action", "Arrived action", FIELD_SOURCES.local),
      important("cancel_action", "Cancel action", FIELD_SOURCES.local),
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_AT_PICKUP]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_AT_PICKUP,
    title: "Driver at pickup",
    goal: "Confirm boarding and handle no-show safely.",
    fields: [
      critical("passenger_name", "Passenger name", FIELD_SOURCES.profile),
      critical("passenger_photo", "Passenger photo or avatar", FIELD_SOURCES.profile),
      critical("boarding_pin", "Boarding PIN/code", FIELD_SOURCES.booking),
      critical("boarding_timer", "Boarding countdown", FIELD_SOURCES.runtime),
      critical("pickup_address", "Pickup address", FIELD_SOURCES.booking),
      critical("contact_actions", "Call/chat actions", FIELD_SOURCES.local),
      important("no_show_action", "No-show action", FIELD_SOURCES.local),
      critical("start_trip_action", "Start trip action", FIELD_SOURCES.local),
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_IN_TRIP]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_IN_TRIP,
    title: "Driver in trip",
    goal: "Navigate and finish the ride with net earnings visible.",
    fields: [
      critical("destination_address", "Destination", FIELD_SOURCES.booking),
      critical("eta_final", "Final ETA", FIELD_SOURCES.route),
      critical("distance_remaining", "Distance remaining", FIELD_SOURCES.route),
      critical("route_progress", "Route progress", FIELD_SOURCES.route),
      critical("net_payout", "Driver net payout", FIELD_SOURCES.pricing),
      critical("passenger_name", "Passenger name", FIELD_SOURCES.profile),
      critical("passenger_photo", "Passenger photo or avatar", FIELD_SOURCES.profile),
      critical("navigation_action", "Navigation action", FIELD_SOURCES.local),
      important("report_problem_action", "Report problem action", FIELD_SOURCES.support),
      critical("finish_trip_action", "Finish trip action", FIELD_SOURCES.local),
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_OPERATIONAL_INTERRUPTED]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_OPERATIONAL_INTERRUPTED,
    title: "Driver operational interruption",
    goal: "Resolve a trip that cannot continue normally.",
    fields: [
      critical("interruption_reason", "Interruption reason", FIELD_SOURCES.runtime),
      critical("current_location", "Current location", FIELD_SOURCES.route),
      critical("passenger_name", "Passenger name", FIELD_SOURCES.profile),
      critical("support_action", "Support action", FIELD_SOURCES.support),
      important("refund_or_adjustment_context", "Refund/adjustment context", FIELD_SOURCES.payment),
      critical("confirm_interruption_action", "Confirm interruption action", FIELD_SOURCES.local),
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_COMPLETED_SUMMARY]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_COMPLETED_SUMMARY,
    title: "Driver completed summary",
    goal: "Make the driver feel the value of the platform after going offline or completing work.",
    fields: [
      critical("final_net_payout", "Final net payout", FIELD_SOURCES.pricing),
      important("gross_fare", "Gross fare", FIELD_SOURCES.pricing),
      important("leaf_fees", "Leaf fees", FIELD_SOURCES.pricing),
      critical("daily_total_earnings", "Daily total earnings", FIELD_SOURCES.pricing),
      important("market_comparison", "Market comparison without naming competitor", FIELD_SOURCES.pricing),
      important("goal_streak", "Goal streak", FIELD_SOURCES.runtime),
      important("daily_goal_progress", "Daily goal progress", FIELD_SOURCES.runtime),
      important("today_trip_count", "Today trip count", FIELD_SOURCES.runtime),
      important("online_time", "Online time", FIELD_SOURCES.runtime),
      contextual("cashout_action", "Cashout action", FIELD_SOURCES.payment),
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_DESTINATION_MODE]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_DESTINATION_MODE,
    title: "Driver destination mode",
    goal: "Make destination constraints transparent before filtering offers.",
    fields: [
      critical("target_destination", "Target destination", FIELD_SOURCES.runtime),
      critical("expires_at", "Expiration time", FIELD_SOURCES.runtime),
      important("minimum_progress", "Minimum trip progress toward destination", FIELD_SOURCES.runtime),
      important("arrival_radius", "Arrival radius", FIELD_SOURCES.runtime),
      critical("disable_destination_mode_action", "Disable action", FIELD_SOURCES.local),
    ],
  }),
  [RIDE_CARD_STATES.DRIVER_BLOCKED]: contract({
    role: RIDE_CARD_ROLES.DRIVER,
    state: RIDE_CARD_STATES.DRIVER_BLOCKED,
    title: "Driver blocked",
    goal: "Explain why the driver cannot go online and how to fix it.",
    fields: [
      critical("block_reason", "Block reason", FIELD_SOURCES.runtime),
      critical("missing_steps", "Missing steps", FIELD_SOURCES.runtime),
      critical("activation_cta", "Activation/KYC CTA", FIELD_SOURCES.local),
      important("support_action", "Support action", FIELD_SOURCES.support),
    ],
  }),
});

export const RIDE_CARD_CONTRACTS = Object.freeze({
  [RIDE_CARD_ROLES.PASSENGER]: passengerContracts,
  [RIDE_CARD_ROLES.DRIVER]: driverContracts,
});

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function normalizeState(state) {
  return String(state || "").trim().toLowerCase();
}

function normalizeFieldId(fieldId) {
  return String(fieldId || "").trim().toLowerCase();
}

function uniqueNonEmptyValues(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function normalizeRenderedFieldTestIDs(value) {
  if (Array.isArray(value)) {
    return uniqueNonEmptyValues(value);
  }

  if (value && typeof value === "object") {
    return uniqueNonEmptyValues(
      value.testIDs ||
        value.testIds ||
        value.renderedTestIDs ||
        value.renderedTestIds ||
        [value.testID || value.testId],
    );
  }

  return uniqueNonEmptyValues([value]);
}

function normalizeRenderedFieldEntries(renderedFields = []) {
  const rawEntries = Array.isArray(renderedFields)
    ? renderedFields
    : Object.entries(renderedFields || {}).map(([id, value]) => {
        const entry =
          value && typeof value === "object" && !Array.isArray(value)
            ? value
            : { testIDs: normalizeRenderedFieldTestIDs(value) };

        return { id, ...entry };
      });

  const renderedMap = new Map();

  rawEntries.forEach((entry) => {
    const id = normalizeFieldId(
      typeof entry === "string" ? entry : entry?.id || entry?.fieldId,
    );

    if (!id) {
      return;
    }

    const previous = renderedMap.get(id);
    const nextTestIDs =
      typeof entry === "string" ? [] : normalizeRenderedFieldTestIDs(entry);

    renderedMap.set(
      id,
      Object.freeze({
        id,
        testIDs: uniqueNonEmptyValues([
          ...(previous?.testIDs || []),
          ...nextTestIDs,
        ]),
      }),
    );
  });

  return renderedMap;
}

export function getRideCardFieldTestID(role, state, fieldId) {
  const normalizedRole = normalizeRole(role);
  const normalizedState = normalizeState(state);
  const normalizedFieldId = normalizeFieldId(fieldId);

  return `ride-card-field-${normalizedRole}-${normalizedState}-${normalizedFieldId}`;
}

export function createRideCardFieldTestIDs(role, state, fieldIds = [], testIDOverrides = {}) {
  return Object.freeze(
    fieldIds.reduce((acc, fieldId) => {
      const normalizedFieldId = normalizeFieldId(fieldId);
      if (!normalizedFieldId) {
        return acc;
      }

      acc[normalizedFieldId] =
        testIDOverrides[normalizedFieldId] ||
        getRideCardFieldTestID(role, state, normalizedFieldId);
      return acc;
    }, {}),
  );
}

export function defineRideCardRenderedFields(role, state, fieldIds = [], options = {}) {
  const testIDsByFieldId = createRideCardFieldTestIDs(
    role,
    state,
    fieldIds,
    options.testIDs || options.testIDOverrides || {},
  );

  return Object.freeze(
    fieldIds.map((fieldId) =>
      Object.freeze({
        id: normalizeFieldId(fieldId),
        testID: testIDsByFieldId[normalizeFieldId(fieldId)],
      }),
    ),
  );
}

export function getRideCardContract(role, state) {
  const normalizedRole = normalizeRole(role);
  const normalizedState = normalizeState(state);
  return RIDE_CARD_CONTRACTS[normalizedRole]?.[normalizedState] || null;
}

export function listRideCardContracts(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole) {
    return Object.values(RIDE_CARD_CONTRACTS[normalizedRole] || {});
  }

  return Object.values(RIDE_CARD_CONTRACTS).flatMap((contractsByRole) =>
    Object.values(contractsByRole),
  );
}

export function getRideCardRequiredFields(role, state, options = {}) {
  const contractForState = getRideCardContract(role, state);
  if (!contractForState) {
    return [];
  }

  const includeImportant = options.includeImportant !== false;
  return contractForState.fields.filter((candidate) => {
    if (candidate.priority === RIDE_CARD_PRIORITIES.CRITICAL) {
      return true;
    }

    return includeImportant && candidate.priority === RIDE_CARD_PRIORITIES.IMPORTANT;
  });
}

export function validateRideCardRenderedFields(role, state, renderedFieldIds = [], options = {}) {
  const requiredFields = getRideCardRequiredFields(role, state, options);
  const renderedMap = normalizeRenderedFieldEntries(renderedFieldIds);
  const isTestIDRendered =
    typeof options.isTestIDRendered === "function"
      ? options.isTestIDRendered
      : typeof options.queryByTestId === "function"
        ? (testID) => Boolean(options.queryByTestId(testID))
        : null;
  const requireTestIDs = options.requireTestIDs === true || Boolean(isTestIDRendered);
  const missing = requiredFields.filter((candidate) => !renderedMap.has(candidate.id));
  const presentRequiredFields = requiredFields.filter((candidate) =>
    renderedMap.has(candidate.id),
  );
  const missingRenderTargets = requireTestIDs
    ? presentRequiredFields.filter((candidate) => {
        const renderedEntry = renderedMap.get(candidate.id);
        return !renderedEntry?.testIDs?.length;
      })
    : [];
  const missingRendered = isTestIDRendered
    ? presentRequiredFields.filter((candidate) => {
        const renderedEntry = renderedMap.get(candidate.id);
        if (!renderedEntry?.testIDs?.length) {
          return false;
        }

        return !renderedEntry.testIDs.some((testID) =>
          isTestIDRendered(testID, candidate),
        );
      })
    : [];

  return Object.freeze({
    ok:
      missing.length === 0 &&
      missingRenderTargets.length === 0 &&
      missingRendered.length === 0,
    missing,
    missingRenderTargets,
    missingRendered,
    requiredFields,
    renderedFields: Object.freeze(Array.from(renderedMap.values())),
  });
}
