// graphql/schema/types/Common.js
// Tipos comuns para GraphQL - Paginação, respostas, etc.

module.exports = `
  scalar Date
  scalar JSON

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type Response {
    success: Boolean!
    message: String
    errors: [Error!]
  }

  type Error {
    field: String
    message: String!
    code: String
  }

  # Tipos para paginação
  input PaginationInput {
    first: Int
    after: String
    last: Int
    before: String
  }

  # Tipos para filtros
  input DateRangeInput {
    startDate: Date!
    endDate: Date!
  }

  input LocationFilterInput {
    latitude: Float!
    longitude: Float!
    radius: Float!
  }

  # Tipos para ordenação
  enum SortOrder {
    ASC
    DESC
  }

  input SortInput {
    field: String!
    order: SortOrder!
  }

  # Input para bounds do mapa
  input LocationBoundsInput {
    northEast: LocationInput!
    southWest: LocationInput!
  }

  # Tipos faltantes para queries
  type UserReport {
    totalUsers: Int!
    activeUsers: Int!
    newUsers: Int!
    userRetention: Float!
    averageRating: Float!
  }

  type TripReport {
    totalTrips: Int!
    completedTrips: Int!
    cancelledTrips: Int!
    averageTripDuration: Int!
    averageTripDistance: Float!
  }

  type CostAnalysis {
    totalCosts: Float!
    costBreakdown: FinancialCostBreakdown!
    profitMargin: Float!
    recommendations: [String!]!
  }

  # Tipo CostBreakdown genérico
  type CostBreakdown {
    mapsApi: Float!
    infrastructure: Float!
    paymentProcessing: Float!
    serverCosts: Float!
    firebaseCosts: Float!
    redisCosts: Float!
    totalOperationalCosts: Float!
  }

  type RealTimeMetrics {
    activeDrivers: Int!
    activeBookings: Int!
    averageWaitTime: Int!
    systemLoad: Float!
  }

  type Payment {
    id: ID!
    amount: Float!
    method: String!
    status: String!
    processedAt: Date!
  }

  type Review {
    id: ID!
    rating: Float!
    comment: String
    createdAt: Date!
  }
`;
