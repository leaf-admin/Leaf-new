# Production Real Validation Battery - 2026-04-10

## Objetivo

Fechar os últimos itens que ainda impedem chamar o app de `GO` para produção pública e submissão pública.

## Escopo obrigatório

### Android release

1. Gerar build com profile `production-apk`
2. Validar OTP real
3. Validar abertura de corrida
4. Validar pagamento Woovi real
5. Validar aceite, chegada, início e término
6. Validar geofence dentro e fora da área
7. Validar rota/mapa/navegação
8. Validar background location com app em segundo plano

### iOS release

1. Gerar build com profile `production`
2. Validar OTP real
3. Validar abertura de corrida
4. Validar pagamento Woovi real
5. Validar aceite, chegada, início e término
6. Validar geofence dentro e fora da área
7. Validar rota/mapa/navegação
8. Validar background location com app em segundo plano

### Consoles

1. Google Play Console
2. App Store Connect

## Comando único para abrir uma rodada

```bash
cd /Users/izaakdias/Documents/Leaf-new/mobile-app
bash scripts/run-production-real-readiness.sh
```

Esse comando:

- roda o preflight técnico
- captura health e páginas legais
- gera uma pasta de evidências
- cria `checklist.md`, `commands.md`, `environment.md` e `summary.md`

## Evidência mínima esperada

### Android

- screenshot do login OTP
- screenshot do pagamento Woovi
- screenshot do estado `driver arrived`
- screenshot do fim da corrida
- evidência de geofence fora da área bloqueando

### iOS

- screenshot do login OTP
- screenshot do pagamento Woovi
- screenshot do estado `driver arrived`
- screenshot do fim da corrida
- evidência de geofence fora da área bloqueando

### Console

- screenshot do Data Safety publicado
- screenshot do account deletion URL cadastrado
- screenshot da declaração de background location
- screenshot das privacy labels no App Store Connect
- screenshot das review notes e App Access

## Critério de GO

- Android release: tudo PASS
- iOS release: tudo PASS
- Play Console: tudo PASS
- App Store Connect: tudo PASS

Sem isso, o correto continua sendo `quase pronto`, não `100% pronto`.
