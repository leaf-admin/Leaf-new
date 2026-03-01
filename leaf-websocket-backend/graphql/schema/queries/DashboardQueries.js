// graphql/schema/queries/DashboardQueries.js
// Queries do Dashboard - Otimizadas para relatórios

module.exports = `
  # Relatório financeiro otimizado
  financialReport(period: String!, input: FinancialReportInput): FinancialReport
  
  # Métricas operacionais
  operationalMetrics(period: String!, input: MetricsInput): OperationalMetrics
  
  # Métricas gerais
  metrics(period: String!, input: MetricsInput): Metrics
  
  # Relatório de usuários
  userReport(period: String!, userType: UserType, status: UserStatus): UserReport
  
  # Relatório de corridas
  tripReport(period: String!, status: BookingStatus): TripReport
  
  # Análise de custos por corrida
  costAnalysis(tripId: ID, period: String): CostAnalysis
  
  # Métricas em tempo real
  realTimeMetrics: RealTimeMetrics
`;




