const mutations = `
  # ===== USER MUTATIONS =====
  input CreateUserInput {
    name: String!
    email: String!
    phone: String!
    userType: UserType!
    profilePicture: String
  }

  input UpdateUserInput {
    name: String
    email: String
    phone: String
    profilePicture: String
    status: UserStatus
  }

  type CreateUserResponse {
    success: Boolean!
    user: User
    message: String
  }

  type UpdateUserResponse {
    success: Boolean!
    user: User
    message: String
  }

  type DeleteUserResponse {
    success: Boolean!
    message: String
  }

  # ===== DRIVER MUTATIONS =====
  input CreateDriverInput {
    name: String!
    email: String!
    phone: String!
    licenseNumber: String!
    vehicle: VehicleInput!
    profilePicture: String
  }

  input UpdateDriverInput {
    name: String
    email: String
    phone: String
    licenseNumber: String
    vehicle: VehicleInput
    status: DriverStatus
    location: LocationInput
  }

  type CreateDriverResponse {
    success: Boolean!
    driver: Driver
    message: String
  }

  type UpdateDriverResponse {
    success: Boolean!
    driver: Driver
    message: String
  }

  type DeleteDriverResponse {
    success: Boolean!
    message: String
  }

  # ===== BOOKING MUTATIONS =====
  input CreateBookingInput {
    passengerId: String!
    pickup: LocationInput!
    destination: LocationInput!
    estimatedFare: Float
    notes: String
  }

  input UpdateBookingInput {
    status: BookingStatus
    driverId: String
    actualFare: Float
    startTime: String
    endTime: String
    notes: String
  }

  type CreateBookingResponse {
    success: Boolean!
    booking: Booking
    message: String
  }

  type UpdateBookingResponse {
    success: Boolean!
    booking: Booking
    message: String
  }

  type DeleteBookingResponse {
    success: Boolean!
    message: String
  }

  # ===== MAIN MUTATIONS =====
  type Mutation {
    # User Mutations
    createUser(input: CreateUserInput!): CreateUserResponse!
    updateUser(id: String!, input: UpdateUserInput!): UpdateUserResponse!
    deleteUser(id: String!): DeleteUserResponse!

    # Driver Mutations
    createDriver(input: CreateDriverInput!): CreateDriverResponse!
    updateDriver(id: String!, input: UpdateDriverInput!): UpdateDriverResponse!
    deleteDriver(id: String!): DeleteDriverResponse!

    # Booking Mutations
    createBooking(input: CreateBookingInput!): CreateBookingResponse!
    updateBooking(id: String!, input: UpdateBookingInput!): UpdateBookingResponse!
    deleteBooking(id: String!): DeleteBookingResponse!

    # Special Actions
    acceptBooking(bookingId: String!, driverId: String!): UpdateBookingResponse!
    cancelBooking(bookingId: String!, reason: String!): UpdateBookingResponse!
    completeBooking(bookingId: String!, actualFare: Float!): UpdateBookingResponse!
  }
`;

module.exports = mutations;
