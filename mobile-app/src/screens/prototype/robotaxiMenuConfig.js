const COMMON_ITEMS = [
  {
    key: 'privacy-account-deletion',
    title: 'Privacidade',
    icon: 'shield-checkmark-outline',
    route: 'PrivacyPolicy',
    detailRoute: 'PrivacyPolicy',
    openDirect: true,
    section: 'support',
    subtitle: 'Dados e preferências da conta'
  },
  {
    key: 'messages',
    title: 'Mensagens',
    icon: 'chatbubbles-outline',
    route: 'RobotaxiPrototypeChat',
    detailRoute: 'RobotaxiMenuMessages',
    openDirect: true,
    section: 'support',
    subtitle: 'Canal com suporte e passageiros'
  },
  {
    key: 'settings',
    title: 'Configurações',
    icon: 'settings-outline',
    route: 'RobotaxiPrototypeSettings',
    detailRoute: 'RobotaxiMenuSettings',
    openDirect: true,
    section: 'support',
    subtitle: 'Notificações, mapa e acessibilidade'
  },
  {
    key: 'help',
    title: 'Ajuda',
    icon: 'help-circle-outline',
    route: 'RobotaxiPrototypeSupport',
    detailRoute: 'RobotaxiMenuHelp',
    openDirect: true,
    section: 'support',
    subtitle: 'Central de ajuda e segurança'
  }
];

function withRole(items, role) {
  return items.map(item => ({
    ...item,
    roles: [role]
  }));
}

const PASSENGER_ITEMS = [
  {
    key: 'edit-profile',
    title: 'Editar perfil',
    icon: 'person-outline',
    route: 'RobotaxiPrototypeProfile',
    detailRoute: 'RobotaxiMenuEditProfile',
    openDirect: true,
    roles: ['customer'],
    section: 'account',
    subtitle: 'Dados pessoais e preferências'
  },
  {
    key: 'trip-history',
    title: 'Histórico de viagens',
    icon: 'time-outline',
    route: 'RobotaxiPrototypeReceipt',
    detailRoute: 'RobotaxiMenuTripHistory',
    openDirect: false,
    roles: ['customer'],
    section: 'rides',
    subtitle: 'Últimas corridas e recibos'
  },
  ...withRole(COMMON_ITEMS, 'customer')
];

const DRIVER_ITEMS = [
  {
    key: 'driver-earnings',
    title: 'Ganhos',
    icon: 'wallet-outline',
    route: 'EarningsReport',
    openDirect: true,
    roles: ['driver'],
    section: 'operations',
    subtitle: 'Saldo, taxa efetiva e leitura financeira'
  },
  {
    key: 'driver-history',
    title: 'Corridas concluídas',
    icon: 'time-outline',
    route: 'RobotaxiPrototypeReceipt',
    detailRoute: 'RobotaxiMenuTripHistory',
    openDirect: false,
    roles: ['driver'],
    section: 'operations',
    subtitle: 'Recibos e resumo de viagens'
  },
  {
    key: 'driver-activation',
    title: 'Ativação do motorista',
    icon: 'shield-checkmark-outline',
    route: 'RobotaxiPrototypeDriverActivation',
    openDirect: true,
    roles: ['driver'],
    section: 'operations',
    subtitle: 'Documentos, validação e liberação online'
  },
  {
    key: 'edit-profile',
    title: 'Perfil do motorista',
    icon: 'person-outline',
    route: 'RobotaxiPrototypeProfile',
    detailRoute: 'RobotaxiMenuEditProfile',
    openDirect: true,
    roles: ['driver'],
    section: 'account',
    subtitle: 'Seus dados e informações da conta'
  },
  ...withRole(COMMON_ITEMS, 'driver')
];

const MENU_SECTIONS = {
  account: {
    key: 'account',
    title: 'Conta'
  },
  rides: {
    key: 'rides',
    title: 'Viagens'
  },
  operations: {
    key: 'operations',
    title: 'Operação'
  },
  support: {
    key: 'support',
    title: 'Suporte e ajustes'
  }
};

export const ROBOTAXI_MENU_ITEMS = [...PASSENGER_ITEMS, ...DRIVER_ITEMS];

export function getMenuItemByRoute(routeName, role) {
  const normalizedRole = role === 'driver' ? 'driver' : 'customer';
  return (
    ROBOTAXI_MENU_ITEMS.find(item => {
      const matchesRoute = item.route === routeName || item.detailRoute === routeName;
      if (!matchesRoute) {
        return false;
      }
      if (!Array.isArray(item.roles) || item.roles.length === 0) {
        return true;
      }
      return item.roles.includes(normalizedRole);
    }) || null
  );
}

export function getMenuItemsByRole(role) {
  const normalizedRole = role === 'driver' ? 'driver' : 'customer';
  return ROBOTAXI_MENU_ITEMS.filter(item => {
    if (!Array.isArray(item?.roles) || item.roles.length === 0) {
      return true;
    }

    return item.roles.includes(normalizedRole);
  });
}

export function getMenuSectionsByRole(role) {
  const items = getMenuItemsByRole(role);
  const bucket = new Map();

  items.forEach(item => {
    const sectionKey = item?.section || 'support';
    if (!bucket.has(sectionKey)) {
      bucket.set(sectionKey, {
        ...(MENU_SECTIONS[sectionKey] || {
          key: sectionKey,
          title: 'Mais opções'
        }),
        items: []
      });
    }

    bucket.get(sectionKey).items.push(item);
  });

  return Array.from(bucket.values()).filter(section => section.items.length > 0);
}

export function resolveMenuTargetRoute(item) {
  if (!item) {
    return 'RobotaxiPrototype';
  }

  if (item.openDirect && item.route) {
    return item.route;
  }

  return item.detailRoute || item.route || 'RobotaxiPrototype';
}
