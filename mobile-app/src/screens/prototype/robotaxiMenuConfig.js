import { CURRENT_SURFACE_STATUS } from './currentSurfaceStatus';

const COMMON_ITEMS = [
  {
    key: 'privacy-account-deletion',
    status: CURRENT_SURFACE_STATUS.CURRENT,
    title: 'Privacidade',
    icon: 'shield-checkmark-outline',
    route: 'PrivacyPolicy',
    detailRoute: 'PrivacyPolicy',
    openDirect: true,
    section: 'support',
    subtitle: 'Dados e preferências da conta'
  },
  {
    key: 'settings',
    status: CURRENT_SURFACE_STATUS.CURRENT,
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
    status: CURRENT_SURFACE_STATUS.CURRENT,
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
    status: CURRENT_SURFACE_STATUS.CURRENT,
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
    status: CURRENT_SURFACE_STATUS.CURRENT,
    title: 'Histórico de viagens',
    icon: 'time-outline',
    route: 'RobotaxiPrototypeReceipt',
    detailRoute: 'RobotaxiMenuTripHistory',
    openDirect: false,
    roles: ['customer'],
    section: 'rides',
    subtitle: 'Últimas corridas e recibos'
  },
  {
    key: 'passenger-invites',
    status: CURRENT_SURFACE_STATUS.CURRENT,
    title: 'Convites',
    icon: 'people-outline',
    route: 'RobotaxiPrototypeInvites',
    openDirect: true,
    roles: ['customer'],
    section: 'account',
    subtitle: 'Links, códigos e pessoas convidadas'
  },
  ...withRole(COMMON_ITEMS, 'customer')
];

const DRIVER_ITEMS = [
  {
    key: 'driver-earnings',
    status: CURRENT_SURFACE_STATUS.CURRENT,
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
    status: CURRENT_SURFACE_STATUS.CURRENT,
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
    status: CURRENT_SURFACE_STATUS.CURRENT,
    title: 'Ativação do motorista',
    icon: 'shield-checkmark-outline',
    route: 'RobotaxiPrototypeDriverActivation',
    openDirect: true,
    roles: ['driver'],
    section: 'operations',
    subtitle: 'Documentos, validação e liberação online'
  },
  {
    key: 'driver-documents',
    status: CURRENT_SURFACE_STATUS.CURRENT,
    title: 'Documentos',
    icon: 'document-text-outline',
    route: 'RobotaxiPrototypeDriverDocuments',
    openDirect: true,
    roles: ['driver'],
    section: 'operations',
    subtitle: 'CNH, CRLV e análise'
  },
  {
    key: 'driver-vehicles',
    status: CURRENT_SURFACE_STATUS.CURRENT,
    title: 'Veículos',
    icon: 'car-outline',
    route: 'RobotaxiPrototypeVehicles',
    openDirect: true,
    roles: ['driver'],
    section: 'operations',
    subtitle: 'Carro autorizado para operar'
  },
  {
    key: 'driver-waitlist-invites',
    status: CURRENT_SURFACE_STATUS.CURRENT,
    title: 'Waitlist e convites',
    icon: 'people-outline',
    route: 'RobotaxiPrototypeDriverWaitlist',
    openDirect: true,
    roles: ['driver'],
    section: 'operations',
    subtitle: 'Fila da cidade e convites de motoristas'
  },
  {
    key: 'edit-profile',
    status: CURRENT_SURFACE_STATUS.CURRENT,
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

export function getMenuItemsByRole(role, options = {}) {
  const normalizedRole = role === 'driver' ? 'driver' : 'customer';
  const referralProgramsEnabled = options.referralProgramsEnabled !== false;
  return ROBOTAXI_MENU_ITEMS.filter(item => {
    if (!Array.isArray(item?.roles) || item.roles.length === 0) {
      return true;
    }

    return item.roles.includes(normalizedRole);
  }).map(item => {
    if (!referralProgramsEnabled && item.key === 'passenger-invites') {
      return {
        ...item,
        status: CURRENT_SURFACE_STATUS.OUT_OF_PILOT,
        subtitle: 'Fora do piloto controlado',
      };
    }

    if (!referralProgramsEnabled && item.key === 'driver-waitlist-invites') {
      return {
        ...item,
        title: 'Waitlist',
        subtitle: 'Fila de ativação da cidade',
        status: CURRENT_SURFACE_STATUS.CURRENT,
      };
    }

    return item;
  });
}

export function getMenuSectionsByRole(role, options = {}) {
  const items = getMenuItemsByRole(role, options);
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
