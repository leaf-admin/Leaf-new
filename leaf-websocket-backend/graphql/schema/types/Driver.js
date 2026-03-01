// graphql/schema/types/Driver.js
// Tipo Driver para GraphQL - Otimizado para motoristas Leaf

module.exports = `
  type Driver {
    id: ID!
    name: String!
    email: String!
    phone: String!
    status: DriverStatus!
    rating: Float!
    totalTrips: Int!
    isOnline: Boolean!
    
    # Relacionamentos
    vehicle: Vehicle!
    location: Location
    bookings(first: Int, after: String): BookingConnection
    
    # Métricas do motorista
    metrics: DriverMetrics
  }

  enum DriverStatus {
    AVAILABLE
    BUSY
    OFFLINE
    SUSPENDED
  }

  type DriverMetrics {
    totalTrips: Int!
    completedTrips: Int!
    cancelledTrips: Int!
    averageRating: Float!
    totalEarnings: Float!
    todayEarnings: Float!
    weeklyEarnings: Float!
    monthlyEarnings: Float!
    acceptanceRate: Float!
    completionRate: Float!
    lastTripDate: Date
  }

  type DriverConnection {
    edges: [DriverEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type DriverEdge {
    node: Driver!
    cursor: String!
  }

  input DriverInput {
    name: String!
    email: String!
    phone: String!
    vehicle: VehicleInput!
  }

  input DriverUpdateInput {
    status: DriverStatus
    location: LocationInput
  }
`;




