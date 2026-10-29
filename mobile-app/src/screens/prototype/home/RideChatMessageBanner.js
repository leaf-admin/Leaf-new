import React, { useEffect, useRef, useState } from 'react';
import LeafActionBanner from '../../../components/design-system/LeafActionBanner';

// Mensagem no chat (estudo 5.3): informação com "Responder", para os dois lados.
// Some em 5 s; um aviso por mensagem; aviso que chegou há mais de 15 s não aparece
// (a pessoa estava em outra tela e a mensagem já está no chat).
export const RIDE_CHAT_NOTICE_AUTO_HIDE_MS = 5000;
export const RIDE_CHAT_NOTICE_MAX_AGE_MS = 15000;

export function resolveRideChatNoticeTitle(senderType) {
  const normalized = String(senderType || '').trim().toLowerCase();
  if (normalized === 'driver') return 'Mensagem do motorista';
  if (normalized === 'passenger' || normalized === 'customer') return 'Mensagem do passageiro';
  return 'Nova mensagem';
}

export default function RideChatMessageBanner({
  notice,
  bookingId,
  top = 0,
  onReply,
  onDismiss,
  now = Date.now,
}) {
  const [visibleNotice, setVisibleNotice] = useState(null);
  const shownIdsRef = useRef(new Set());
  const rideKey = String(bookingId || '').trim();

  useEffect(() => {
    const noticeId = String(notice?.id || '').trim();
    if (!noticeId || shownIdsRef.current.has(noticeId)) {
      return;
    }
    const sameRide = !rideKey || String(notice?.bookingId || '').trim() === rideKey;
    const fresh = now() - Number(notice?.receivedAt || 0) <= RIDE_CHAT_NOTICE_MAX_AGE_MS;
    if (!sameRide || !fresh) {
      return;
    }
    shownIdsRef.current.add(noticeId);
    setVisibleNotice(notice);
  }, [notice, now, rideKey]);

  useEffect(() => {
    if (!visibleNotice) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setVisibleNotice(null);
      onDismiss?.();
    }, RIDE_CHAT_NOTICE_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [onDismiss, visibleNotice]);

  if (!visibleNotice) {
    return null;
  }

  const close = () => {
    setVisibleNotice(null);
    onDismiss?.();
  };

  return (
    <LeafActionBanner
      key={visibleNotice.id}
      tone="info"
      icon="chatbubble-ellipses-outline"
      top={top}
      title={resolveRideChatNoticeTitle(visibleNotice.senderType)}
      message={visibleNotice.text}
      actionLabel={onReply ? 'Responder' : undefined}
      onAction={onReply ? () => { close(); onReply(); } : undefined}
      onPress={close}
      testID="ride-chat-message-banner"
    />
  );
}
