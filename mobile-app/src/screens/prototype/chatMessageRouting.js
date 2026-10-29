function normalizeId(value) {
  return String(value || "").trim();
}

// Mensagem que chega pelo socket: com o chat aberto, só a da conversa aberta; com o
// chat fechado, só a da corrida ativa (vira o aviso "Mensagem do passageiro/motorista").
export function shouldAcceptIncomingChatMessage(state = {}, incomingChatId = "") {
  const chatId = normalizeId(incomingChatId);
  if (!chatId) {
    return false;
  }
  if (state.activeChatId || state.activeChatBookingId) {
    return !state.activeChatId ||
      chatId === state.activeChatId ||
      chatId === state.activeChatBookingId;
  }
  const activeRideBookingId = normalizeId(
    state.activeBookingId ||
      state.driverActiveRide?.bookingId ||
      state.driverActiveRide?.id,
  );
  return Boolean(activeRideBookingId) && chatId === activeRideBookingId;
}
