export const ROBOTAXI_MENU_ITEMS = [
  {
    key: 'edit-profile',
    title: 'Editar perfil',
    icon: 'person-outline',
    route: 'RobotaxiMenuEditProfile',
    subtitle: 'Dados pessoais e preferências',
    sections: [
      { label: 'Nome', value: 'Ana Dias' },
      { label: 'Telefone', value: '+55 11 9 9999-9999' },
      { label: 'Email', value: 'ana.dias@email.com' },
      { label: 'Preferência', value: 'Corridas silenciosas' }
    ]
  },
  {
    key: 'trip-history',
    title: 'Histórico de viagens',
    icon: 'time-outline',
    route: 'RobotaxiPrototypeReceipt',
    openDirect: true,
    subtitle: 'Últimas corridas e recibos',
    sections: [
      { label: 'Hoje 14:20', value: 'Mission St -> Castro St' },
      { label: 'Ontem 09:05', value: 'Market St -> Ferry Building' },
      { label: 'Dom 20:41', value: 'SoMa -> Marina District' }
    ]
  },
  {
    key: 'messages',
    title: 'Mensagens',
    icon: 'chatbubbles-outline',
    route: 'RobotaxiPrototypeChat',
    openDirect: true,
    subtitle: 'Canal com motoristas e suporte',
    sections: [
      { label: 'Suporte', value: 'Sua solicitação foi recebida.' },
      { label: 'Motorista', value: 'Chego em 4 min.' },
      { label: 'Sistema', value: 'Pagamento confirmado.' }
    ]
  },
  {
    key: 'notifications',
    title: 'Notificações',
    icon: 'notifications-outline',
    subtitle: 'Alertas da corrida e do painel do motorista',
    sections: [
      { label: 'Corridas', value: 'Atualizações em tempo real' },
      { label: 'Pagamento', value: 'Confirmações e alertas' },
      { label: 'Operação', value: 'Eventos de suporte e segurança' }
    ]
  },
  {
    key: 'settings',
    title: 'Configurações',
    icon: 'settings-outline',
    route: 'RobotaxiPrototypeSettings',
    openDirect: true,
    subtitle: 'Notificações, mapa e acessibilidade',
    sections: [
      { label: 'Alertas de corrida', value: 'Ativado' },
      { label: 'Camada de trânsito', value: 'Ativado' },
      { label: 'Instruções por voz', value: 'Desativado' }
    ]
  },
  {
    key: 'help',
    title: 'Ajuda',
    icon: 'help-circle-outline',
    route: 'RobotaxiPrototypeSupport',
    openDirect: true,
    subtitle: 'Central de ajuda e segurança',
    sections: [
      { label: 'Emergência', value: 'Acesso rápido ao botão SOS' },
      { label: 'Objetos perdidos', value: 'Abrir chamado em até 24h' },
      { label: 'Atendimento', value: 'Chat disponível 24/7' }
    ]
  },
  {
    key: 'driver-panel',
    title: 'Modo motorista',
    icon: 'speedometer-outline',
    route: 'RobotaxiPrototypeDriverPanel',
    openDirect: true,
    subtitle: 'Dashboard e corridas em tempo real',
    sections: [
      { label: 'Status', value: 'Online' },
      { label: 'Corridas hoje', value: '12' },
      { label: 'Ganhos', value: 'R$ 312,00' }
    ]
  },
  {
    key: 'driver-activation',
    title: 'Ativação do motorista',
    icon: 'shield-checkmark-outline',
    route: 'RobotaxiPrototypeDriverActivation',
    openDirect: true,
    subtitle: 'Etapas de liberação para ficar online',
    sections: [
      { label: 'Etapa 1', value: 'Dados do motorista' },
      { label: 'Etapa 2', value: 'Validação facial' },
      { label: 'Etapa 3', value: 'Documentos do veículo' }
    ]
  }
];

export function getMenuItemByRoute(routeName) {
  return ROBOTAXI_MENU_ITEMS.find(item => item.route === routeName) || null;
}
