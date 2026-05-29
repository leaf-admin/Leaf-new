# Fluxo de revalidacao de identidade por suporte

## Objetivo

Quando passageiro reportar que o motorista aparenta ser diferente do cadastro/foto exibida no app, a Leaf deve proteger a operacao sem expor o motivo ao motorista e sem interromper corrida em andamento.

## Gatilhos

- Ticket de suporte com texto ou metadados indicando "motorista diferente", "foto diferente", "outro motorista", "condutor diferente" ou equivalentes.
- Avaliacao pos-corrida do passageiro com a mesma sinalizacao.
- Auditoria manual por amostragem de cadastros com suspeita de CNH falsa ou inconsistente.

## Regras de produto

- Nunca abrir revalidacao durante uma corrida ativa.
- Se houver corrida ativa, registrar `identityReverification.status = deferred_until_trip_end`.
- Ao terminar ou cancelar a corrida, aplicar o gate antes de o motorista receber nova corrida.
- No app, a copy sempre deve ser generica: "Por seguranca, precisamos validar sua identidade."
- Nao mencionar erro de cadastro, foto divergente, denuncia ou fraude no app.
- Primeiro impacto e soft block: motorista nao recebe nova corrida ate validar.
- Se houver mismatch ou baixa confianca na revalidacao, aplicar block e direcionar para suporte.

## Validacoes usadas agora

- AWS Rekognition Face Liveness para prova de vida.
- Microservico Leaf de face compare para selfie atual contra embedding da face extraida da CNH.
- Validador simples de identidade documental para confirmar que o arquivo enviado parece CNH e nao RG/outro documento.
- Auditoria por amostragem e dados de suporte, sem endpoint pago de validacao documental neste momento.

## Metricas obrigatorias

- `notificationSentAt`
- `validationStartedAt`
- `validationCompletedAt`
- `notificationToValidationStartedSeconds`
- `notificationToValidationCompletedSeconds`
- `validationDurationSeconds`

Essas metricas ajudam a investigar se houve deslocamento temporal relevante entre notificacao e validacao.

## Persistencia principal

- Realtime Database: `users/{driverId}/identityReverification`
- Firestore: `kyc_events`
- Redis: `driver:{driverId}` com `kyc_reverify_required`, `dispatchEligible=false` e `identity_reverification_challenge_id`

## Casos de decisao

- Match aprovado: limpar `kycReverifyRequired`, liberar status KYC como `approved`.
- Review/baixa confianca: bloquear modo motorista e enviar para suporte.
- Mismatch: bloquear modo motorista e enviar para suporte.
- Corrida ativa: adiar, sem notificacao e sem modal durante a viagem.
