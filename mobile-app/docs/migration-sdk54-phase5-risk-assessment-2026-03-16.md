# Fase 5 - Dependencias nativas fora da matriz Expo (avaliacao inicial)

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Status rapido

- Base RN/Expo atual: `react-native@0.81.5` + `expo@54`.
- Validacao local de build: `expo-doctor` e `expo prebuild` Android/iOS OK.
- Validacao remota: builds EAS do commit atual em fila.

## Resultado por biblioteca critica

1. `@react-native-firebase/*`
- Acao: upgrade para `23.8.8`.
- Resultado: prebuild Android/iOS OK no SDK 54.
- Status: risco reduzido.

2. `@react-native-google-signin/google-signin`
- Atual: `10.1.2`
- Ultima disponivel: `16.1.2`
- Status: defasada (major gap). Exige janela dedicada para upgrade e reteste de auth social.

3. `expo-text-recognition`
- Atual: `0.1.1` (tambem ultima disponivel)
- Status: manter sob monitoramento; sem update de versao disponivel no npm.

4. `react-native-pdf`
- Atual: `7.0.3` (ultima disponivel)
- Status: sem gap de versao.

5. `react-native-blob-util`
- Atual: `0.24.5`
- Ultima disponivel: `0.24.7`
- Status: gap pequeno (patch).

6. `react-native-elements`
- Atual: `3.4.3` (ultima disponivel; pacote sem releases recentes)
- Status: risco estrutural de manutencao.

7. `react-native-vector-icons`
- Atual: `9.0.0`
- Ultima disponivel: `10.3.0`
- Status: defasada (major gap), com impacto potencial em `react-native-elements`.

8. `react-native-gifted-chat`
- Atual: `2.4.0`
- Ultima disponivel: `3.3.2`
- Status: defasada (major gap), requer reteste funcional de chat.

## Recomendacao de sequenciamento (seguro)

1. Fechar validacao remota do SDK 54 (Android/iOS) com o commit atual.
2. Tratar pacote por pacote em PRs pequenas:
   - `@react-native-google-signin/google-signin`
   - `react-native-blob-util` (patch)
   - `react-native-vector-icons` (avaliar junto com `react-native-elements`)
   - `react-native-gifted-chat`
3. Para `react-native-elements`, abrir trilha de substituicao gradual por biblioteca ativa ou componentes internos.
