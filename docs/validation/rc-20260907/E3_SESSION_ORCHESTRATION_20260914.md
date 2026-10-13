# E3 bilateral — persistência da sessão e ordem do gate (14/09/2026)

## Diagnóstico

O bloqueio observado no login do motorista foi criado pelo próprio orquestrador
de QA. O fluxo
[`01-driver-login-online-8082.yaml`](../../../mobile-app/.maestro/flows/qa/e2e/01-driver-login-online-8082.yaml)
começava com `launchApp: clearState: true`. O preflight já faz o reset único do
simulador antes do bootstrap; executar esse fluxo em seguida apagava a sessão
Firebase/AsyncStorage recém-criada antes de o gate KYC/online poder usá-la.

Há ainda uma proteção legítima que não deve ser removida: o
`SessionTerminatedGuard` encerra a sessão local do motorista quando o backend
emite `sessionTerminated` para um novo login do mesmo UID. O backend substitui
os sockets anteriores de motorista quando sessões simultâneas não estão
autorizadas. O log Android de 03/09 registra `SessionTerminated` com
`previousSocketId`/`newSocketId`, o payload correspondente a
`SESSION_REPLACED`, confirmando esse caminho. Portanto, outro
simulador, aparelho ou dev client conectado com o mesmo motorista pode encerrar
a sessão que está sendo usada no E3.

O alerta de KYC visto nesta rodada é um terceiro evento, independente da
persistência: `GET /api/kyc/liveness/provider` falhou no app e o gate fechou com
`Não foi possível preparar a validação agora.` Não há chamada a `signOut` no
gate online/KYC; o logout automático só ocorre no evento de sessão substituída.

## Correções aplicadas

- O fluxo de login do motorista agora usa `launchApp` sem `clearState`. O reset
  fica explícito no bootstrap `qa-session-reset-ios.yaml`/preflight e não se
  repete entre login, KYC, online e corrida.
- O contrato Jest de QA verifica que o fluxo bilateral não reintroduza
  `clearState: true`.
- Os runners atuais foram alinhados ao simulador existente
  `Leaf iPhone 17 Driver E3` (`0DA1FB5E-2308-4F40-87DD-A8C04F7E7878`); o
  simulador removido `Serafy QA` não é mais default.

## Ordem correta para o E3

1. Reservar um UID de motorista para esta execução e encerrar o app desse UID
   em qualquer outro aparelho/simulador. Não abrir o mesmo UID em dois clients.
2. Rodar o preflight uma vez. Ele limpa o estado dos dois simuladores, define a
   geofence e abre o Dev Client.
3. Rodar o fluxo de login do motorista com `--no-reinstall-driver` e variáveis
   Maestro via `-e` (as variáveis do shell não substituem variáveis Maestro):

   ```bash
   JAVA_HOME=/Users/izaakdias/.local/mobile-build-tools/jdk-17 \
   PATH=/Users/izaakdias/.local/mobile-build-tools/jdk-17/bin:/Users/izaakdias/.maestro/bin:$PATH \
   maestro test --no-reinstall-driver \
     --udid "$DRIVER_UDID" \
     -e MAESTRO_METRO_HOST=127.0.0.1 \
     -e MAESTRO_METRO_PORT=8097 \
     -e MAESTRO_METRO_URL_DRIVER='exp+leafapp-reactnative://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8097' \
     mobile-app/.maestro/flows/qa/e2e/01-driver-login-online-8082.yaml
   ```

   Depois do login, não usar nenhum fluxo com `clearState`.
4. Aceitar localização/KYC e aguardar `driver-online` + elegibilidade de
   dispatch. Se o provedor KYC falhar, registrar `NOT_RUN`; não usar bypass.
5. Autenticar o passageiro no outro simulador e só então iniciar cotação,
   pagamento sandbox, oferta, aceite, chegada, início, movimento, conclusão,
   recibo, settlement e avaliações.
6. Em cada relaunch/reabertura durante a corrida, usar `launchApp` sem limpar
   estado e coletar o log de `sessionTerminated` para distinguir encerramento
   remoto de falha de persistência.

## Evidência desta tentativa

- Preflight: 30 passes, 3 warnings, 0 failures em
  `mobile-app/test-results/qa-preflight/preflight-20260914_144533.log`.
- O canary Woovi escopado aos usuários QA passou em
  `mobile-app/test-results/e3-real-20260914/payment-runtime.json`; o default
  global continua produção e por isso o guard global corretamente não é um
  PASS de sandbox.
- O alerta KYC está em
  `mobile-app/test-results/e3-real-20260914/driver-location-permission/screenshots/driver-after-location-permission.png`.
- Nenhum `bookingId`, cobrança ou corrida foi criado nesta tentativa.
- O contrato de fluxo passou: 26 testes em
  `mobile-app/__tests__/qa-seed-current-routes.test.js`.

Durante a tentativa de reexecução, o host também perdeu o
`CoreSimulatorService` (os comandos `simctl` retornaram `Connection refused`) e
o Expo não conseguiu abrir o Metro local, encerrando com
`ERR_SOCKET_BAD_PORT`. Esses são bloqueios do host de QA; não são sinais de que
o app deva limpar a sessão ou de que o backend deva aceitar um bypass.

Esta rodada ainda não é um E3 integrado aprovado. Para fechar o gate falta
reexecutar o fluxo com a sessão preservada, sem outro socket do mesmo UID, e
obter uma resposta válida do provedor KYC no ambiente autorizado. O E3 bilateral
de 12/09 permanece como evidência histórica separada.
