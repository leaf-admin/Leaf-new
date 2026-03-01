// graphql/schema/types/Booking.js
// Tipo Booking para GraphQL - Otimizado para corridas Leaf

module.exports = `
  type Booking {
    id: ID!
    passenger: User!
    driver: User
    pickup: Location!
    destination: Location!
    status: BookingStatus!
    fare: Float
    distance: Float
    duration: Int
    createdAt: Date!
    updatedAt: Date!
    
    # Relacionamentos otimizados
    route: Route
    payment: Payment
    reviews: [Review!]
    
    # Métricas da corrida
    metrics: BookingMetrics
  }

  enum BookingStatus {
    PENDING
    ACCEPTED
    IN_PROGRESS
    COMPLETED
    CANCELLED
    PAID
  }

  type BookingMetrics {
    estimatedArrival: String
    actualArrival: String
    waitTime: Int
    travelTime: Int
    costBreakdown: BookingCostBreakdown
  }

  type BookingCostBreakdown {
    baseFare: Float!
    distanceFare: Float!
    timeFare: Float!
    surgeMultiplier: Float
    totalFare: Float!
    commission: Float!
    driverEarnings: Float!
  }

  type BookingConnection {
    edges: [BookingEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type BookingEdge {
    node: Booking!
    cursor: String!
  }

  input BookingInput {
    pickup: LocationInput!
    destination: LocationInput!
    passengerId: ID!
    estimatedFare: Float
  }

  input BookingUpdateInput {
    status: BookingStatus
    driverId: ID
    fare: Float
    distance: Float
    duration: Int
  }
`;
