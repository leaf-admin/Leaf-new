// graphql/schema/queries/DriverQueries.js
// Queries de Motoristas - Otimizadas com Redis GEO

module.exports = `
  # Buscar motorista por ID
  driver(id: ID!): Driver
  
  # Listar motoristas com filtros
  drivers(
    first: Int
    after: String
    status: DriverStatus
    isOnline: Boolean
    sortBy: String
    sortOrder: SortOrder
  ): DriverConnection
  
  # Buscar motoristas próximos (OTIMIZADO)
  nearbyDrivers(
    location: LocationInput!
    radius: Float
    limit: Int
    vehicleType: VehicleType
  ): [Driver!]!
  
  # Motoristas ativos no mapa
  activeDrivers(
    bounds: LocationBoundsInput
    status: DriverStatus
  ): [Driver!]!
  
  # Métricas de motorista específico
  driverMetrics(driverId: ID!, period: String): DriverMetrics
  
  # Histórico de corridas do motorista
  driverBookings(
    driverId: ID!
    first: Int
    after: String
    status: BookingStatus
    dateRange: DateRangeInput
  ): BookingConnection
  
  # Status do motorista em tempo real
  driverStatus(driverId: ID!): DriverStatus
`;
