// graphql/resolvers/index.js
// Resolvers principais GraphQL para Leaf App

const DashboardResolver = require('./DashboardResolver');
const UserResolver = require('./UserResolver');
const DriverResolver = require('./DriverResolver');
const BookingResolver = require('./BookingResolver');
const MutationResolver = require('./MutationResolver');
const SubscriptionResolver = require('./SubscriptionResolver');

// Resolvers principais
const resolvers = {
  Query: {
    // Dashboard Queries
    financialReport: DashboardResolver.financialReport.bind(DashboardResolver),
    operationalMetrics: DashboardResolver.operationalMetrics.bind(DashboardResolver),
    metrics: DashboardResolver.metrics.bind(DashboardResolver),
    
    // User Queries
    user: UserResolver.user.bind(UserResolver),
    users: UserResolver.users.bind(UserResolver),
    nearbyUsers: UserResolver.nearbyUsers.bind(UserResolver),
    userMetrics: UserResolver.userMetrics.bind(UserResolver),
    userBookings: UserResolver.userBookings.bind(UserResolver),
    
    // Driver Queries
    driver: DriverResolver.driver.bind(DriverResolver),
    drivers: DriverResolver.drivers.bind(DriverResolver),
    nearbyDrivers: DriverResolver.nearbyDrivers.bind(DriverResolver),
    activeDrivers: DriverResolver.activeDrivers.bind(DriverResolver),
    driverMetrics: DriverResolver.driverMetrics.bind(DriverResolver),
    driverBookings: DriverResolver.driverBookings.bind(DriverResolver),
    driverStatus: DriverResolver.driverStatus.bind(DriverResolver),
    
    // Booking Queries
    booking: BookingResolver.booking.bind(BookingResolver),
    bookings: BookingResolver.bookings.bind(BookingResolver),
    activeBookings: BookingResolver.activeBookings.bind(BookingResolver),
    bookingHistory: BookingResolver.bookingHistory.bind(BookingResolver),
    bookingMetrics: BookingResolver.bookingMetrics.bind(BookingResolver),
    bookingCostAnalysis: BookingResolver.bookingCostAnalysis.bind(BookingResolver),
    popularRoutes: BookingResolver.popularRoutes.bind(BookingResolver)
  },

  Mutation: {
    // User Mutations
    createUser: MutationResolver.createUser.bind(MutationResolver),
    updateUser: MutationResolver.updateUser.bind(MutationResolver),
    deleteUser: MutationResolver.deleteUser.bind(MutationResolver),

    // Driver Mutations
    createDriver: MutationResolver.createDriver.bind(MutationResolver),
    updateDriver: MutationResolver.updateDriver.bind(MutationResolver),
    deleteDriver: MutationResolver.deleteDriver.bind(MutationResolver),

    // Booking Mutations
    createBooking: MutationResolver.createBooking.bind(MutationResolver),
    updateBooking: MutationResolver.updateBooking.bind(MutationResolver),
    deleteBooking: MutationResolver.deleteBooking.bind(MutationResolver),

    // Special Actions
    acceptBooking: MutationResolver.acceptBooking.bind(MutationResolver),
    cancelBooking: MutationResolver.cancelBooking.bind(MutationResolver),
    completeBooking: MutationResolver.completeBooking.bind(MutationResolver)
  },

  Subscription: {
    // Location Subscriptions
    driverLocationUpdate: SubscriptionResolver.driverLocationUpdate,
    passengerLocationUpdate: SubscriptionResolver.passengerLocationUpdate,
    nearbyDriversUpdates: SubscriptionResolver.nearbyDriversUpdates,

    // Booking Subscriptions
    bookingStatusUpdate: SubscriptionResolver.bookingStatusUpdate,
    newBookingRequest: SubscriptionResolver.newBookingRequest,
    bookingAccepted: SubscriptionResolver.bookingAccepted,
    activeBookingUpdates: SubscriptionResolver.activeBookingUpdates
  },

  // Resolvers para tipos específicos
  User: {
    bookings: UserResolver.bookings.bind(UserResolver),
    vehicle: UserResolver.vehicle.bind(UserResolver),
    location: UserResolver.location.bind(UserResolver),
    metrics: UserResolver.metrics.bind(UserResolver)
  },

  Driver: {
    vehicle: DriverResolver.vehicle.bind(DriverResolver),
    location: DriverResolver.location.bind(DriverResolver),
    bookings: DriverResolver.bookings.bind(DriverResolver),
    metrics: DriverResolver.metrics.bind(DriverResolver)
  },

  Booking: {
    passenger: BookingResolver.passenger.bind(BookingResolver),
    driver: BookingResolver.driver.bind(BookingResolver),
    route: BookingResolver.route.bind(BookingResolver),
    payment: BookingResolver.payment.bind(BookingResolver),
    reviews: BookingResolver.reviews.bind(BookingResolver),
    metrics: BookingResolver.metrics.bind(BookingResolver)
  },

  Vehicle: {
    driver: async (parent, args, context) => {
      // Implementar busca do motorista do veículo
      return null;
    }
  },

  Location: {
    // Resolvers específicos para Location se necessário
  },

  FinancialReport: {
    // Resolvers específicos para FinancialReport se necessário
  },

  Metrics: {
    // Resolvers específicos para Metrics se necessário
  },

  // Resolvers para tipos de conexão
  UserConnection: {
    // Resolvers específicos para UserConnection se necessário
  },

  DriverConnection: {
    // Resolvers específicos para DriverConnection se necessário
  },

  BookingConnection: {
    // Resolvers específicos para BookingConnection se necessário
  },

  // Resolvers para tipos de métricas
  UserMetrics: {
    // Resolvers específicos para UserMetrics se necessário
  },

  DriverMetrics: {
    // Resolvers específicos para DriverMetrics se necessário
  },

  BookingMetrics: {
    // Resolvers específicos para BookingMetrics se necessário
  },

  // Resolvers para tipos de breakdown
  CostBreakdown: {
    // Resolvers específicos para CostBreakdown se necessário
  },

  BookingCostBreakdown: {
    // Resolvers específicos para BookingCostBreakdown se necessário
  },

  FinancialCostBreakdown: {
    // Resolvers específicos para FinancialCostBreakdown se necessário
  },

  // Resolvers para tipos de relatório
  TopRoute: {
    // Resolvers específicos para TopRoute se necessário
  },

  DailyMetric: {
    // Resolvers específicos para DailyMetric se necessário
  },

  PeriodComparison: {
    // Resolvers específicos para PeriodComparison se necessário
  },

  // Resolvers para tipos de métricas operacionais
  OperationalMetrics: {
    // Resolvers específicos para OperationalMetrics se necessário
  },

  FinancialMetrics: {
    // Resolvers específicos para FinancialMetrics se necessário
  },

  SystemUserMetrics: {
    // Resolvers específicos para SystemUserMetrics se necessário
  },

  SystemDriverMetrics: {
    // Resolvers específicos para SystemDriverMetrics se necessário
  },

  SystemMetrics: {
    // Resolvers específicos para SystemMetrics se necessário
  },

  // Resolvers para tipos de área
  AreaMetrics: {
    // Resolvers específicos para AreaMetrics se necessário
  },

  // Resolvers para tipos de relatório
  UserReport: {
    // Resolvers específicos para UserReport se necessário
  },

  TripReport: {
    // Resolvers específicos para TripReport se necessário
  },

  CostAnalysis: {
    // Resolvers específicos para CostAnalysis se necessário
  },

  RealTimeMetrics: {
    // Resolvers específicos para RealTimeMetrics se necessário
  },

  // Resolvers para tipos de pagamento e avaliação
  Payment: {
    // Resolvers específicos para Payment se necessário
  },

  Review: {
    // Resolvers específicos para Review se necessário
  },

  // Resolvers para tipos de rota
  Route: {
    // Resolvers específicos para Route se necessário
  },

  TrafficInfo: {
    // Resolvers específicos para TrafficInfo se necessário
  },

  // Resolvers para tipos de veículo
  VehicleDocuments: {
    // Resolvers específicos para VehicleDocuments se necessário
  },

  // Resolvers para tipos de resposta
  Response: {
    // Resolvers específicos para Response se necessário
  },

  Error: {
    // Resolvers específicos para Error se necessário
  },

  // Resolvers para tipos de página
  PageInfo: {
    // Resolvers específicos para PageInfo se necessário
  },

  // Resolvers para tipos de edge
  UserEdge: {
    // Resolvers específicos para UserEdge se necessário
  },

  DriverEdge: {
    // Resolvers específicos para DriverEdge se necessário
  },

  BookingEdge: {
    // Resolvers específicos para BookingEdge se necessário
  },

  // Resolvers para tipos de breakdown de receita
  RevenueBreakdown: {
    // Resolvers específicos para RevenueBreakdown se necessário
  }
};

module.exports = resolvers;
