# Fase 5 - Dependencias nativas fora da matriz Expo (avaliacao)

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Status rapido

- Base RN/Expo atual: `react-native@0.81.5` + `expo@54`.
- Validacao local de build:
- `npx expo-doctor` -> `17/17 checks passed`.
- `npm run build:local:android:release` -> OK.
- `npm run build:local:android:aab` -> OK.
- `npm run build:local:ios:simulator` -> OK.
- Smoke iOS simulator (`simctl install/launch`) -> OK.
- Bloqueio conhecido: `npm run build:local:ios:archive` falha sem `Development Team` de assinatura.

## Resultado por biblioteca critica

1. `@react-native-firebase/*`
- Acao: upgrade para `23.8.8`.
- Resultado: prebuild Android/iOS OK no SDK 54.
- Status: risco reduzido.

2. `@react-native-google-signin/google-signin`
- Atual: `10.1.2`
- Ultima disponivel: `16.1.2`
- Evidencia tecnica: compila em Android/iOS no SDK 54 (presente nos logs de build local).
- Status: compativel no estado atual, porem defasada (major gap). Exige janela dedicada para upgrade e reteste de auth social.

3. `expo-text-recognition`
- Atual: `0.1.1` (tambem ultima disponivel)
- Evidencia tecnica: compila em Android/iOS no SDK 54.
- Status: manter sob monitoramento; sem update de versao disponivel no npm.

4. `react-native-pdf`
- Atual: `7.0.3` (ultima disponivel)
- Evidencia tecnica: compila em Android/iOS no SDK 54.
- Status: sem gap de versao.

5. `react-native-blob-util`
- Atual: `0.24.5`
- Ultima disponivel: `0.24.7`
- Evidencia tecnica: compila em Android/iOS no SDK 54.
- Status: gap pequeno (patch).

6. `react-native-elements`
- Atual: `3.4.3` (ultima disponivel; pacote sem releases recentes)
- Observacao: biblioteca majoritariamente JS (risco de manutencao, nao de build nativo).
- Status: risco estrutural de manutencao.

7. `react-native-vector-icons`
- Atual: `9.0.0`
- Ultima disponivel: `10.3.0`
- Evidencia tecnica: compila em Android/iOS no SDK 54.
- Status: defasada (major gap), com impacto potencial em `react-native-elements`.

8. `react-native-gifted-chat`
- Atual: `2.4.0`
- Ultima disponivel: `3.3.2`
- Observacao: biblioteca majoritariamente JS (risco maior de regressao funcional do que nativa).
- Status: defasada (major gap), requer reteste funcional de chat.

## Recomendacao de sequenciamento (seguro)

1. Fechar assinatura local iOS (Development Team + provisioning) para destravar archive/export sem EAS.
2. Tratar pacote por pacote em PRs pequenas:
   - `@react-native-google-signin/google-signin`
   - `react-native-blob-util` (patch)
   - `react-native-vector-icons` (avaliar junto com `react-native-elements`)
   - `react-native-gifted-chat`
3. Para `react-native-elements`, abrir trilha de substituicao gradual por biblioteca ativa ou componentes internos.
