'use strict';

const PUBLIC_TICKET_FIELDS = Object.freeze([
  'id',
  'userId',
  'userType',
  'subject',
  'description',
  'category',
  'priority',
  'status',
  'createdAt',
  'updatedAt',
  'resolvedAt',
  'closedAt',
  'attachments'
]);

const PUBLIC_MESSAGE_FIELDS = Object.freeze([
  'id',
  'ticketId',
  'senderType',
  'message',
  'messageType',
  'attachments',
  'createdAt'
]);

function copyAllowedFields(source, fields) {
  const safeSource = source && typeof source === 'object' ? source : {};
  return fields.reduce((result, field) => {
    if (safeSource[field] !== undefined) {
      result[field] = safeSource[field];
    }
    return result;
  }, {});
}

function serializeSupportTicket(ticket, { isAgent = false } = {}) {
  if (!ticket || typeof ticket !== 'object') return ticket;
  if (isAgent) return ticket;

  const visible = copyAllowedFields(ticket, PUBLIC_TICKET_FIELDS);
  const bookingId = ticket.bookingId || ticket.metadata?.bookingId || null;
  if (bookingId) {
    visible.bookingId = String(bookingId);
  }
  return visible;
}

function serializeSupportMessage(message, { isAgent = false } = {}) {
  if (!message || typeof message !== 'object') return message;
  if (isAgent) return message;
  if (message.isInternal === true) return null;
  return copyAllowedFields(message, PUBLIC_MESSAGE_FIELDS);
}

function serializeSupportMessages(messages, options = {}) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => serializeSupportMessage(message, options))
    .filter(Boolean);
}

module.exports = {
  PUBLIC_TICKET_FIELDS,
  PUBLIC_MESSAGE_FIELDS,
  serializeSupportTicket,
  serializeSupportMessage,
  serializeSupportMessages
};
