// graphql/schema/types/User.js
// Tipo User para GraphQL - Otimizado para Leaf App

module.exports = `
  type User {
    id: ID!
    name: String!
    email: String!
    phone: String
    userType: UserType!
    status: UserStatus!
    rating: Float
    totalTrips: Int
    createdAt: Date!
    updatedAt: Date!
    
    # Relacionamentos otimizados
    bookings(first: Int, after: String, status: BookingStatus): BookingConnection
    vehicle: Vehicle
    location: Location
    
    # Métricas do usuário
    metrics: UserMetrics
  }

  enum UserType {
    CUSTOMER
    DRIVER
    ADMIN
  }

  enum UserStatus {
    ACTIVE
    INACTIVE
    SUSPENDED
    PENDING_VERIFICATION
  }

  type UserMetrics {
    totalTrips: Int!
    completedTrips: Int!
    cancelledTrips: Int!
    averageRating: Float
    totalSpent: Float
    totalEarned: Float
    lastTripDate: Date
  }

  type UserConnection {
    edges: [UserEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type UserEdge {
    node: User!
    cursor: String!
  }

  input UserInput {
    name: String!
    email: String!
    phone: String
    userType: UserType!
  }

  input UserUpdateInput {
    name: String
    email: String
    phone: String
    status: UserStatus
  }
`;




