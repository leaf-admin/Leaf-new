// graphql/schema/mutations/BookingMutations.js
// Mutations de Corridas - Serão implementadas na Semana 2

module.exports = `
  # Criar solicitação de corrida
  createBooking(input: BookingInput!): Booking
  
  # Atualizar corrida
  updateBooking(id: ID!, input: BookingUpdateInput!): Booking
  
  # Cancelar corrida
  cancelBooking(bookingId: ID!, reason: String): Booking
  
  # Finalizar corrida
  completeBooking(bookingId: ID!, fare: Float!, distance: Float!, duration: Int!): Booking
  
  # Avaliar corrida
  rateBooking(bookingId: ID!, rating: Float!, comment: String): Booking
`;




