function normalizeId(value) {
  return String(value || "").trim();
}

// Mensagem que chega pelo socket: vale a da conversa aberta ou a da corrida ativa.
// O id do chat fica salvo entre aberturas do app; um id de corrida anterior não pode
// barrar a mensagem da corrida atual (vira o aviso "Mensagem do passageiro/motorista").
export function shouldAcceptIncomingChatMessage(state = {}, incomingChatId = "") {
  const chatId = normalizeId(incomingChatId);
  if (!chatId) {
    return false;
  }
  const activeRideBookingId = normalizeId(
    state.activeBookingId ||
      state.driverActiveRide?.bookingId ||
      state.driverActiveRide?.id,
  );
  return [
    normalizeId(state.activeChatId),
    normalizeId(state.activeChatBookingId),
    activeRideBookingId,
  ].some((knownId) => knownId && knownId === chatId);
}
