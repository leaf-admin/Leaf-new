// graphql/schema/types/FinancialReport.js
// Tipo FinancialReport para GraphQL - Relatórios financeiros otimizados

module.exports = `
  type FinancialReport {
    period: String!
    totalRevenue: Float!
    totalCosts: Float!
    profitMargin: Float!
    totalTrips: Int!
    averageFare: Float!
    
    # Breakdown detalhado
    costBreakdown: FinancialCostBreakdown!
    revenueBreakdown: RevenueBreakdown!
    
    # Top rotas e métricas
    topRoutes: [TopRoute!]!
    dailyMetrics: [DailyMetric!]!
    
    # Comparações
    previousPeriod: PeriodComparison
  }

  type FinancialCostBreakdown {
    mapsApi: Float!
    infrastructure: Float!
    paymentProcessing: Float!
    serverCosts: Float!
    firebaseCosts: Float!
    redisCosts: Float!
    totalOperationalCosts: Float!
  }

  type RevenueBreakdown {
    rideFares: Float!
    commissions: Float!
    subscriptions: Float!
    marketing: Float!
    other: Float!
  }

  type TopRoute {
    route: String!
    frequency: Int!
    revenue: Float!
    averageFare: Float!
    distance: Float!
  }

  type DailyMetric {
    date: Date!
    trips: Int!
    revenue: Float!
    costs: Float!
    profit: Float!
  }

  type PeriodComparison {
    revenueChange: Float!
    costChange: Float!
    profitChange: Float!
    tripChange: Float!
    percentageChange: Float!
  }

  input FinancialReportInput {
    period: String!
    startDate: Date
    endDate: Date
    includeBreakdown: Boolean
    includeTopRoutes: Boolean
    limit: Int
  }
`;
