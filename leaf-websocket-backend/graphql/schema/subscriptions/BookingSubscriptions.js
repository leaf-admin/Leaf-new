// graphql/schema/subscriptions/BookingSubscriptions.js
// Subscriptions de Corridas - Serão implementadas na Semana 3

module.exports = `
  # Atualizações de status da corrida
  bookingStatusUpdates(bookingId: ID!): Booking
  
  # Novas solicitações de corrida (para motoristas)
  newBookingRequests(driverId: ID!): Booking
  
  # Atualizações de corrida em andamento
  activeBookingUpdates(bookingId: ID!): Booking
`;




