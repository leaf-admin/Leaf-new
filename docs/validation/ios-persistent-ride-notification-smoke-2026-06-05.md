# Smoke iOS - Notificacao persistente de corrida v1 - 2026-06-05

Branch: `codex/auth-push-hardening`

Objetivo: deixar pronto o roteiro para validar em iPhone fisico a notificacao persistente textual de corrida entregue por FCM e renderizada pelo app via `expo-notifications`.

## Escopo da v1

O que esta validado/esperado:

- FCM de lifecycle da corrida: `accepted`, `arrived`, `started`, `completed`.
- Texto rico com ETA local e linha de progresso textual.
- Sem chamada a Google, Woovi, Maps, Routes ou Places durante a atualizacao da notificacao.
- Idempotencia visual basica: duplicar `accepted` nao deve criar varias notificacoes ativas da mesma corrida.
- `completed` deve limpar a notificacao de corrida ativa.
- Contrato mobile pronto para Live Activity via `LeafRideActivity.startOrUpdate/end`, controlado por runtime config.

O que nao faz parte desta v1:

- UI nativa de Live Activity / Dynamic Island.
- Notificacao realmente fixa/nao dispensavel no iOS.
- Remote push nativo com UI customizada fora do controle do sistema.

Esses itens ficam no ticket nativo `LEA-96`. O runtime ja deixa `iosLiveActivityEnabled=false`, `iosLiveActivityMode=disabled` e `iosNotificationFallbackEnabled=true`; quando a extensao nativa estiver pronta, a ativacao deve ser feita pelo backend sem mudar o fluxo JS.

## Pre-requisitos

- iPhone fisico com app instalado.
- Build iOS usando o `GoogleService-Info.plist` correto para `br.com.leaf.ride`.
- Usuario logado no app com permissao de notificacao concedida.
- Token FCM do usuario registrado no backend/Redis.
- Backend Contabo com `sendRideStatusUpdate` publicado.
- Redis acessivel via tunnel SSH local, ou `--redis-url` explicito.

Tunnel recomendado:

```bash
ssh -fN -i /Users/izaakdias/.ssh/leaf_contabo_20260412_ed25519 \
  -o ExitOnForwardFailure=yes \
  -L 6380:127.0.0.1:6379 \
  root@api.leaf.app.br
```

## Comando de smoke

```bash
node /Users/izaakdias/Documents/Leaf-new/scripts/validation/send-ride-status-notification-smoke.cjs \
  --platform ios \
  --user-id <IOS_USER_ID> \
  --booking-id smoke-ios-persistent-$(date +%Y%m%d%H%M%S)
```

Dry-run sem envio:

```bash
node /Users/izaakdias/Documents/Leaf-new/scripts/validation/send-ride-status-notification-smoke.cjs \
  --platform ios \
  --user-id test-ios-user \
  --dry-run
```

## Passo a passo no device

1. Conectar ou parear o iPhone.
2. Confirmar que o app abre e o usuario esta logado.
3. Confirmar permissao de notificacoes habilitada no iOS.
4. Abrir o app uma vez para garantir registro/refresh de FCM token.
5. Rodar o tunnel Redis.
6. Rodar o comando de smoke com o `IOS_USER_ID` correto.
7. Observar as notificacoes em tres condicoes:
   - app em foreground;
   - app em background;
   - tela bloqueada, quando possivel.

## Criterios de aceite

- `accepted`: aparece uma notificacao de corrida com titulo semelhante a `Carlos esta a caminho` e texto iniciando com `Chegada ao embarque em`.
- `accepted` duplicado: nao gera pilha de notificacoes repetidas para o mesmo `bookingId`.
- `arrived`: atualiza para `Carlos chegou`.
- `started`: atualiza para `A caminho de Barra Shopping` e exibe ETA de viagem.
- `completed`: remove/limpa a notificacao ativa da corrida.
- Nenhum fallback visual estranho, notificacao antiga ou texto tecnico aparece para o usuario.
- Nenhuma chamada externa paga e disparada durante o smoke.

## Evidencias a coletar

- Screenshot da notificacao `accepted`.
- Screenshot da notificacao `arrived`.
- Screenshot da notificacao `started`.
- Screenshot apos `completed`, mostrando que nao restou notificacao ativa da corrida.
- Output do comando de smoke.
- Observacao se o app estava foreground, background ou locked.

Pasta sugerida:

```text
/Users/izaakdias/Documents/Leaf-new/artifacts/smoke-20260605-ios-physical/
```

## Bloqueios conhecidos

- Se o iOS nao receber data-only push em app fechado, isso e comportamento esperado do sistema e deve virar ajuste nativo/servidor no `LEA-96`.
- Se o token FCM nao existir para o usuario iOS, a build precisa validar o `GoogleService-Info.plist` correto e o fluxo de registro/refresh de token.
- Se a notificacao aparece somente com app aberto, registrar como limitacao da v1 e priorizar payload APNs visivel ou Live Activity na frente nativa.
- Para Live Activity de producao, ainda falta criar Widget Extension/ActivityKit UI e decidir se as atualizacoes remotas usarao push token proprio da ActivityKit ou apenas atualizacao local enquanto app esta ativo.
