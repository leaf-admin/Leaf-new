// graphql/schema/types/Metrics.js
// Tipo Metrics para GraphQL - Métricas operacionais

module.exports = `
  type Metrics {
    operational: OperationalMetrics!
    financial: FinancialMetrics!
    user: SystemUserMetrics!
    driver: SystemDriverMetrics!
    system: SystemMetrics!
  }

  type OperationalMetrics {
    totalTrips: Int!
    completedTrips: Int!
    cancelledTrips: Int!
    averageTripDuration: Int!
    averageTripDistance: Float!
    peakHours: [String!]!
    busyAreas: [AreaMetrics!]!
  }

  type FinancialMetrics {
    totalRevenue: Float!
    totalCosts: Float!
    netProfit: Float!
    profitMargin: Float!
    averageFare: Float!
    commissionRate: Float!
  }

  type SystemUserMetrics {
    totalUsers: Int!
    activeUsers: Int!
    newUsers: Int!
    userRetention: Float!
    averageRating: Float!
  }

  type SystemDriverMetrics {
    totalDrivers: Int!
    activeDrivers: Int!
    onlineDrivers: Int!
    averageDriverRating: Float!
    driverSatisfaction: Float!
  }

  type SystemMetrics {
    uptime: Float!
    responseTime: Float!
    errorRate: Float!
    throughput: Float!
    cacheHitRate: Float!
  }

  type AreaMetrics {
    area: String!
    tripCount: Int!
    revenue: Float!
    averageFare: Float!
  }

  input MetricsInput {
    period: String!
    startDate: Date
    endDate: Date
    includeOperational: Boolean
    includeFinancial: Boolean
    includeUser: Boolean
    includeDriver: Boolean
    includeSystem: Boolean
  }
`;
