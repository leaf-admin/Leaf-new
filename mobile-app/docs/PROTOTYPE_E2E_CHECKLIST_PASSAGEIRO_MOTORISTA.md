# Checklist E2E - Protótipo UI/UX (Passageiro + Motorista)

## Escopo
- Validar fluxo completo de corrida no protótipo com mapa único e overlays.
- Validar integrações reais de socket para booking, pagamento, chat e suporte.
- Validar consistência visual dos menus/submenus funcionais.

## Pré-requisitos
- Backend websocket ativo.
- App aberto em `RobotaxiPrototype` no iOS Simulator.
- Usuário autenticado (ou sessão dev com conexão de socket disponível).

## 1. Fluxo Passageiro (Core)
1. Abrir campo `Para onde?` e selecionar um destino real.
2. Confirmar categoria/valor e avançar para `Pagamento`.
3. Confirmar pagamento e solicitar corrida.
4. Verificar tela de busca de motorista com timer.
5. Aceitar corrida pelo fluxo motorista (menu > modo motorista).
6. Voltar ao passageiro e validar transição para `Trip`.
7. Iniciar e finalizar corrida.
8. Validar recibo com valores.

### Resultado esperado
- Booking criado via socket.
- Pagamento em estado `confirmed` ou `pending` sem quebrar fluxo.
- Status de corrida muda em tempo real (`searching` -> `accepted` -> `started` -> `completed`).

## 2. Fluxo Motorista (Core)
1. Abrir menu e entrar em `Modo motorista`.
2. Alternar online/offline no painel.
3. Selecionar oferta e abrir tela de aceite.
4. Aceitar corrida.
5. Iniciar e finalizar corrida pela tela de motorista.

### Resultado esperado
- Status do motorista sincroniza via socket.
- Corrida aceita atualiza também fluxo do passageiro.
- Finalização gera recibo no passageiro.

## 3. Chat em Tempo Real
1. Abrir submenu `Mensagens` no menu lateral.
2. Enviar mensagem rápida.
3. Abrir tela de chat completa.

### Resultado esperado
- Mensagem enviada via `sendMessage`.
- Sessão carregada via `createChat` + `loadChatMessages`.
- Erros aparecem em UI sem travar a tela.

## 4. Suporte e Segurança
1. Abrir submenu `Ajuda` no menu lateral.
2. Informar descrição e abrir ticket.
3. Informar descrição e registrar incidente.
4. Abrir central de suporte completa.

### Resultado esperado
- Ticket criado via `createSupportTicket`.
- Incidente registrado via `reportIncident`.
- IDs recentes retornam na UI do submenu.

## 5. Menu e Submenus Funcionais
1. Abrir menu e entrar em `Editar perfil`.
2. Atualizar nome/telefone/email/preferência e salvar.
3. Voltar e entrar em `Configurações` (submenu do menu).
4. Alterar toggles e confirmar efeito no mapa (trânsito).

### Resultado esperado
- Navegação de submenu com animação lateral.
- Perfil salvo no runtime e refletido na tela de perfil.
- Configuração de trânsito refletida no mapa principal.

## 6. Robustez Visual / Estado
1. Abrir/fechar múltiplos overlays em sequência.
2. Cancelar corrida em busca.
3. Voltar ao estado inicial e recomeçar fluxo.

### Resultado esperado
- Menus superior/inferior continuam fixos.
- Sem re-render de mapa por tela.
- Sem travamentos de navegação ou overlays órfãos.

## 7. Ambiente de Simulador iOS
1. Abrir app no simulador e acompanhar logs iniciais.

### Resultado esperado
- Sem erro bloqueante de FCM token (simulador ignora push token real).

## Registro de execução
- Data:
- Build:
- Device:
- Resultado geral:
- Observações:
