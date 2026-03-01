const subscriptions = `
  # ===== LOCATION SUBSCRIPTIONS =====
  type DriverLocationUpdate {
    driverId: String!
    location: Location!
    timestamp: String!
    estimatedArrival: String
    distance: Float
  }

  type PassengerLocationUpdate {
    passengerId: String!
    location: Location!
    timestamp: String!
  }

  type NearbyDriversUpdate {
    location: Location!
    drivers: [Driver!]!
    timestamp: String!
  }

  # ===== BOOKING SUBSCRIPTIONS =====
  type BookingStatusUpdate {
    bookingId: String!
    status: BookingStatus!
    timestamp: String!
    driver: Driver
    estimate: String
    actualFare: Float
  }

  type NewBookingRequest {
    bookingId: String!
    passenger: User!
    pickup: Location!
    destination: Location!
    estimate: String
    distance: Float
    timestamp: String!
  }

  type BookingAccepted {
    bookingId: String!
    driver: Driver!
    estimatedArrival: String
    driverLocation: Location!
    timestamp: String!
  }

  type ActiveBookingUpdate {
    bookingId: String!
    driverLocation: Location!
    passengerLocation: Location
    estimatedArrival: String
    distance: Float
    timestamp: String!
  }
`;

module.exports = subscriptions;
