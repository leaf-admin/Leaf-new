import React, { useEffect, useRef } from 'react';
import { FlatList, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { FadeInDown } from 'react-native-reanimated';
import LeafLineIcon from '../../components/design-system/LeafLineIcon';
import { leafInk, leafTouch, leafType } from '../../components/design-system/leafTypeScale';
import leafTypography from '../../components/prototype/LeafTypography';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const STAGGERED_ROWS = 8;

export function formatNotificationTime(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor(Math.max(0, now - time) / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  if (hours < 48) return 'ontem';
  const date = new Date(time);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function NotificationRow({ item, index, onPress }) {
  const unread = !item.read;
  return (
    <Reanimated.View entering={index < STAGGERED_ROWS ? FadeInDown.delay(index * 35).duration(220) : undefined}>
      <Pressable
        onPress={() => onPress(item)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Nova. ' : ''}${item.title}. ${item.message}`}
        testID={`notification-row-${item.id}`}
      >
        <View style={[styles.unreadDot, !unread && styles.unreadDotHidden]} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.rowTime}>{formatNotificationTime(item.createdAt)}</Text>
          </View>
          {item.message ? (
            <Text style={styles.rowMessage} numberOfLines={2}>
              {item.message}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Reanimated.View>
  );
}

export default function RobotaxiNotificationsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { notifications = [], unreadNotificationCount = 0, markNotificationRead, markAllNotificationsRead } =
    usePrototypeRideRuntime();

  // New items stay highlighted while the inbox is open; leaving clears the badge.
  const markAllRef = useRef(markAllNotificationsRead);
  markAllRef.current = markAllNotificationsRead;
  useEffect(() => () => markAllRef.current?.(), []);

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('RobotaxiPrototype');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="notifications-screen">
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          style={styles.backButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          testID="notifications-back"
        >
          <LeafLineIcon name="back" size={22} color={leafInk.primary} />
        </Pressable>
        {unreadNotificationCount > 0 ? (
          <Pressable
            onPress={() => markAllNotificationsRead?.()}
            hitSlop={8}
            accessibilityRole="button"
            testID="notifications-mark-all"
          >
            <Text style={styles.headerAction}>Marcar como lidas</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.title} accessibilityRole="header">
        Notificações
      </Text>

      <FlatList
        data={notifications}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => (
          <NotificationRow item={item} index={index} onPress={(row) => markNotificationRead?.(row.id)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
        ListEmptyComponent={
          <View style={styles.empty} testID="notifications-empty">
            <LeafLineIcon name="bell" size={36} color={leafInk.secondary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Nenhuma notificação</Text>
            <Text style={styles.emptyBody}>Avisos das suas corridas e da sua conta aparecem aqui.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: leafTouch.minimum,
    height: leafTouch.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAction: {
    ...leafType.caption,
    ...leafTypography.semiBold,
    fontSize: 15,
    color: leafInk.brand,
    paddingHorizontal: 12,
  },
  title: {
    ...leafType.display,
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  listContent: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 16,
    paddingLeft: 12,
    paddingRight: 24,
  },
  rowPressed: {
    backgroundColor: leafInk.surface,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 7,
    marginRight: 4,
    backgroundColor: leafInk.route,
  },
  unreadDotHidden: {
    backgroundColor: 'transparent',
  },
  rowBody: {
    flex: 1,
    paddingLeft: 0,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
  },
  rowTitle: {
    ...leafType.headline,
    ...leafTypography.medium,
    flex: 1,
  },
  rowTitleUnread: {
    ...leafTypography.semiBold,
  },
  rowTime: {
    ...leafType.caption,
    fontVariant: ['tabular-nums'],
  },
  rowMessage: {
    ...leafType.body,
    color: leafInk.secondary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: leafInk.divider,
    marginLeft: 24,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
    gap: 8,
  },
  emptyTitle: {
    ...leafType.headline,
    marginTop: 8,
  },
  emptyBody: {
    ...leafType.body,
    color: leafInk.secondary,
    textAlign: 'center',
  },
});
