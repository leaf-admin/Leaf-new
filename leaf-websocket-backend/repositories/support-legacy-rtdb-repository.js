class SupportLegacyRtdbRepository {
  constructor(db, {
    ticketsPath = 'support_tickets',
    messagesPath = 'support_messages'
  } = {}) {
    this.db = db || null;
    this.ticketsPath = ticketsPath;
    this.messagesPath = messagesPath;
  }

  isAvailable() {
    return !!this.db;
  }

  async getTicket(ticketId) {
    if (!this.isAvailable()) return null;
    const snapshot = await this.db.ref(`${this.ticketsPath}/${ticketId}`).once('value');
    if (snapshot?.exists && !snapshot.exists()) return null;
    return snapshot?.val?.() || null;
  }

  async listTickets() {
    if (!this.isAvailable()) return {};
    const snapshot = await this.db.ref(this.ticketsPath).once('value');
    return snapshot?.val?.() || {};
  }

  async listTicketsByUser(userId) {
    if (!this.isAvailable()) return {};
    const snapshot = await this.db
      .ref(this.ticketsPath)
      .orderByChild('userId')
      .equalTo(String(userId))
      .once('value');
    return snapshot?.val?.() || {};
  }

  async getMessages(ticketId) {
    if (!this.isAvailable()) return {};
    const snapshot = await this.db.ref(`${this.messagesPath}/${ticketId}`).once('value');
    return snapshot?.val?.() || {};
  }

  async updateTicket(ticketId, ticket) {
    if (!this.isAvailable()) return false;
    await this.db.ref(`${this.ticketsPath}/${ticketId}`).update(ticket);
    return true;
  }

  async setMessage(ticketId, messageId, message) {
    if (!this.isAvailable()) return false;
    await this.db.ref(`${this.messagesPath}/${ticketId}/${messageId}`).set(message);
    return true;
  }
}

module.exports = SupportLegacyRtdbRepository;
