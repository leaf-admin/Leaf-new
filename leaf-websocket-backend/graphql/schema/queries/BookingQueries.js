// graphql/schema/queries/BookingQueries.js
// Queries de Corridas - Otimizadas para performance

module.exports = `
  # Buscar corrida por ID
  booking(id: ID!): Booking
  
  # Listar corridas com filtros
  bookings(
    first: Int
    after: String
    status: BookingStatus
    passengerId: ID
    driverId: ID
    dateRange: DateRangeInput
    sortBy: String
    sortOrder: SortOrder
  ): BookingConnection
  
  # Corridas em andamento
  activeBookings(
    passengerId: ID
    driverId: ID
  ): [Booking!]!
  
  # Histórico de corridas
  bookingHistory(
    userId: ID!
    userType: UserType!
    first: Int
    after: String
    dateRange: DateRangeInput
  ): BookingConnection
  
  # Métricas de corrida específica
  bookingMetrics(bookingId: ID!): BookingMetrics
  
  # Análise de custos da corrida
  bookingCostAnalysis(bookingId: ID!): CostBreakdown
  
  # Rotas populares
  popularRoutes(
    period: String!
    limit: Int
    city: String
  ): [TopRoute!]!
`;




