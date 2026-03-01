// graphql/schema/index.js
// Schema principal GraphQL para Leaf App

const { buildSchema } = require('graphql');

// Importar tipos
const CommonTypes = require('./types/Common');
const UserTypes = require('./types/User');
const DriverTypes = require('./types/Driver');
const BookingTypes = require('./types/Booking');
const VehicleTypes = require('./types/Vehicle');
const LocationTypes = require('./types/Location');
const FinancialReportTypes = require('./types/FinancialReport');
const MetricsTypes = require('./types/Metrics');

// Importar queries
const DashboardQueries = require('./queries/DashboardQueries');
const UserQueries = require('./queries/UserQueries');
const DriverQueries = require('./queries/DriverQueries');
const BookingQueries = require('./queries/BookingQueries');

// Importar mutations
const Mutations = require('./mutations');

// Importar subscriptions
const Subscriptions = require('./subscriptions');

const typeDefs = `
  ${CommonTypes}
  
  type Query {
    ${DashboardQueries}
    ${UserQueries}
    ${DriverQueries}
    ${BookingQueries}
  }

  ${Mutations}

  type Subscription {
    # Location Subscriptions
    driverLocationUpdate(bookingId: String!): DriverLocationUpdate!
    passengerLocationUpdate(bookingId: String!): PassengerLocationUpdate!
    nearbyDriversUpdates(location: LocationInput!, radius: Float!): NearbyDriversUpdate!

    # Booking Subscriptions
    bookingStatusUpdate(bookingId: String!): BookingStatusUpdate!
    newBookingRequest(driverId: String!): NewBookingRequest!
    bookingAccepted(passengerId: String!): BookingAccepted!
    activeBookingUpdates(bookingId: String!): ActiveBookingUpdate!
  }

  ${Subscriptions}

  ${UserTypes}
  ${DriverTypes}
  ${BookingTypes}
  ${VehicleTypes}
  ${LocationTypes}
  ${FinancialReportTypes}
  ${MetricsTypes}
`;

// Criar schema executável
const schema = buildSchema(typeDefs);

module.exports = {
  typeDefs,
  schema
};
