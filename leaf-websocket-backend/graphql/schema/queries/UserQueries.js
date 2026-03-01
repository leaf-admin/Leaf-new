// graphql/schema/queries/UserQueries.js
// Queries de Usuários - Otimizadas com paginação

module.exports = `
  # Buscar usuário por ID
  user(id: ID!): User
  
  # Listar usuários com filtros
  users(
    first: Int
    after: String
    userType: UserType
    status: UserStatus
    searchTerm: String
    sortBy: String
    sortOrder: SortOrder
  ): UserConnection
  
  # Buscar usuários próximos (para motoristas)
  nearbyUsers(
    location: LocationInput!
    radius: Float
    userType: UserType
    limit: Int
  ): [User!]!
  
  # Métricas de usuário específico
  userMetrics(userId: ID!, period: String): UserMetrics
  
  # Histórico de corridas do usuário
  userBookings(
    userId: ID!
    first: Int
    after: String
    status: BookingStatus
    dateRange: DateRangeInput
  ): BookingConnection
`;




