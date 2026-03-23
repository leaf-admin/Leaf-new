# Go/No-Go Build Checklist (2026-03-19)

## Contexto
Checklist objetivo para decisao de envio para:
1. iOS TestFlight
2. Android Internal Testing

Baseado em validacoes executadas em 2026-03-19.

## Evidencias executadas
1. Backend unit: 7/7 suites, 29/29 testes
2. Backend integration: 2/2 suites, 30/30 testes
3. Backend e2e completo: 7/7 suites, 20/20 testes
4. Dashboard lint: OK
5. Dashboard build: OK
6. Mobile env local doctor: 16 checks OK, 0 falhas

## Logs de referencia
1. `/tmp/leaf_backend_postpatch_quick_20260319_141226/unit.log`
2. `/tmp/leaf_backend_postpatch_quick_20260319_141226/integration.log`
3. `/tmp/leaf_e2e_full_final2_20260319_140232/e2e.log`
4. `/tmp/leaf_front_checks_20260319_141306/dashboard-lint.log`
5. `/tmp/leaf_front_checks_20260319_141306/dashboard-build.log`
6. `/tmp/leaf_front_checks_20260319_141306/mobile-doctor.log`

## Gate iOS (TestFlight)
1. Assinatura iOS valida no host local: PASS
2. Profile de desenvolvimento para bundle `br.com.leaf.ride`: PASS
3. DEVELOPMENT_TEAM configurado: PASS
4. Backend regressao critica: PASS
5. Fluxos e2e de corrida e pagamento: PASS
6. Bloqueador atual para upload: nenhum bloqueador tecnico encontrado nestes checks

Status iOS: GO

## Gate Android (Internal Testing)
1. Java/SDK/adb/sdmanager detectados: PASS
2. Backend regressao critica: PASS
3. Fluxos e2e de corrida e pagamento: PASS
4. Dashboard operacional (build/lint): PASS
5. Bloqueador atual para upload: nenhum bloqueador tecnico encontrado nestes checks

Status Android: GO

## Gate de publicacao em lojas (Apple/Google)
1. Build tecnica (AAB/IPA): GO
2. Submissao publica nas lojas: NO-GO no momento
3. Motivos bloqueadores de submissao publica:
   - Data Safety pendente no Play Console
   - Declaracao de background location pendente no Play Console
   - URL de account deletion externa pendente de cadastro/confirmacao no Play Console

## Riscos residuais (nao bloqueantes)
1. Aviso de open handles no Jest e2e ao final da suite (nao impediu 7/7 suites e 20/20 testes)
2. `scripts/check-expo.sh` usa validacao local de `node_modules` e pode acusar falso negativo em workspace com hoisting

## Decisao final
1. iOS TestFlight: GO
2. Android Internal Testing: GO
3. App Store / Play Store (publicacao externa): NO-GO ate concluir pendencias de console

## Recomendacao antes do submit final
1. Rodar archive iOS assinado e validar upload no Organizer
2. Gerar AAB release Android e validar upload no Play Console internal
3. Rodar smoke manual rapido em device fisico para push notification, geolocalizacao e pagamento Pix antes de publicar para testers externos
