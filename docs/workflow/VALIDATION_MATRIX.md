# Validation Matrix

Use a menor validacao que cubra o risco da mudanca.

## Docs e processo

```bash
git diff --check
```

## Dashboard

```bash
npm run lint:dashboard
npm run build:dashboard
```

## Mobile

```bash
npm run test:mobile
cd mobile-app && npx expo config --json
```

Quando houver fluxo visual ou loja:

```bash
npm run prelaunch:testids
npm run prelaunch:copy
```

## Backend

```bash
npm run test:backend
npm run test:route-guards --workspace leaf-websocket-backend
```

Quando mexer em runtime/config:

```bash
npm run config:validate --workspace leaf-websocket-backend
```

## Release

```bash
npm run test:profile
npm run lint:dashboard
npm run build:dashboard
npm run test:mobile
npm run test:backend
npm run prelaunch:audit
```

## Dispositivo/simulador

Necessario para submissao ou mudanca de fluxo principal:

- Android: emulador/dispositivo com `adb`.
- iOS: Xcode completo com `xcrun simctl`.
- Fluxo atual: `npm run smoke:mobile:current-flow -- --json`, seguido de interação por simulador/device/Computer Use.
- Maestro: apenas inventário legado ou comparação histórica. Não usar como evidência principal do ciclo atual de corrida.

Se o ambiente local nao permitir, registrar a limitacao no PR e rodar em outra maquina antes de release.
