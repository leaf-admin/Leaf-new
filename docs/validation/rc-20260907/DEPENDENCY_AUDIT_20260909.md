# Leaf — auditoria de dependências de produção

**Data:** 2026-09-09
**Comando:** `npm audit --omit=dev --json`
**Estado:** triagem aberta; risco aceito para staging/E3 conforme confirmação do
responsável; nenhum deploy foi feito por esta sessão

## Resultado

| Momento | Total | Críticas | Altas | Moderadas | Baixas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Antes dos patches | 29 | 1 | 15 | 12 | 1 |
| Após os patches compatíveis | 18 | 0 | 8 | 10 | 0 |

Patches aplicados no mesmo worktree: Next e eslint-config-next `16.3.4`,
`react-native-google-places-autocomplete` `2.6.5`, `sharp` `0.35.4`, além de
overrides para `fast-uri` `3.1.7`, `joi` `17.13.6`, `js-yaml` `4.3.2`, `nanoid`
`3.3.18`, `browserslist` `4.28.9`, `baseline-browser-mapping` `2.11.21` e
`@xmldom/xmldom` `0.8.15`. Os contratos mobile/backend e as suítes afetadas
passaram depois da mudança.

## Pendências

- Altas: `expo`, `@expo/cli`, `@expo/metro`, `@expo/metro-config`, `metro`,
  `metro-config`, `metro-transform-worker` e `image-size`. O fix indicado pelo
  registry exige Expo `57.0.21`, enquanto o app está em Expo 54.
- Moderadas sem correção automática: React Navigation, `query-string` e
  `decode-uri-component`.
- Moderadas com correção incompatível no backend: Express 4, `body-parser` e
  `qs`. O Express 4 declara `qs ~6.15.1`; forçar `qs 6.16.0` produz árvore
  inválida. A migração para Express 5 precisa de revisão e testes de rotas.

Foi verificada também a versão corrigida `decode-uri-component 0.5.0`. Ela é
ESM-only e altera o contrato de carregamento/decodificação usado por
`query-string 7.1.3` (CommonJS); um override direto quebraria o bundle sem
resolver a cadeia do React Navigation. Esse patch foi recusado até haver uma
migração coordenada do consumidor.

Como mitigação enquanto a migração não é aprovada, o backend limita o parser
URL-encoded a 1.000 parâmetros e profundidade 5, e a rota financeira legada de
ganhos está bloqueada em produção. Essas medidas reduzem a superfície, mas não
substituem a atualização da dependência reportada pelo audit.

O dry-run de `npm audit fix` encontrou conflito de peers entre Expo 54 e
`expo-crypto`, que aponta para Expo 57. Não usar `npm audit fix --force` sem
plano de breaking changes, build nativo e validação E3.

## Decisão para o estágio atual

Expo 54/React Native 0.81 permanece como baseline do staging já preparado. A
migração Expo/Metro não é pré-condição do E3 bilateral nem do piloto controlado;
ela fica registrada como hardening pós-piloto (ou exceção formal de segurança
caso a abertura ampla ocorra antes do upgrade). O mesmo vale para a cadeia
Express 4/`qs` e os consumidores de `query-string`.

Os patches compatíveis e os limites de parser aplicados nesta rodada reduzem a
superfície para o E3, mas não encerram o audit. Antes da abertura ampla, o
responsável deve escolher entre upgrade coordenado e exceção de risco, executar
nova auditoria e repetir as validações mobile/backend no SHA resultante.

## Aceite

O audit só pode virar `[x]` para a abertura ampla depois de uma decisão
registrada para cada grupo, com upgrade coordenado ou exceção de risco aprovada,
nova auditoria, testes mobile/backend e atualização do manifesto RC. Para o
estágio atual, ele está classificado como `[~]` pós-piloto e não bloqueia o E3.
