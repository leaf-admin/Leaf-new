# KYC Device-First - Relatorio de Performance (2026-03-12)

## Resumo executivo
- O KYC foi ajustado para **processamento pesado no dispositivo** e validacao leve no backend.
- O backend agora atua como orquestrador/auditoria minima e cache de verificacao (TTL 24h).
- O gargalo principal deixou de ser CPU de verificacao facial no servidor e passou a ser, em cenarios extremos, limite de entrada/rate limit.

## Escopo tecnico aplicado
- Endpoint novo: `POST /api/kyc/verify-driver/device` (JSON, sem upload pesado).
- Fast-path de sucesso:
  - sem fluxo pesado de status em toda requisicao;
  - fluxo pesado so em mismatch ou `recoverBlocked=true`.
- Cache Redis por usuario:
  - chave `kyc_verification:{userId}`
  - validade de 24h.
- Escrita de auditoria detalhada e logs verbosos de sucesso ficaram opcionais por env.

## Freeze de configuracao (soft release)
Arquivo: `config/soft-release.env.example`

Valores chave definidos:
- `KYC_SIMILARITY_THRESHOLD=0.5`
- `KYC_WRITE_AUDIT_KEY=false`
- `KYC_LOG_SUCCESS_VERBOSE=false`

Interpretacao:
- limiar de 50% para aprovacao inicial (MVP).
- menos escrita/log por requisicao para reduzir latencia e custo de CPU/IO.

## Benchmark comparativo (mesmo ambiente de VPS)
### Cenario base (antes da otimizacao de fast-path)
- c20: latencia media ~2018ms | ~9.91 req/s
- c40: latencia media ~2033ms | ~19.66 req/s
- c80: latencia media ~2024ms | ~37.95 req/s

### Cenario otimizado (device-first + fast-path)
- c20: media 20.77ms | p95 41ms | ~938.09 req/s
- c40: media 33.99ms | p95 59ms | ~1145.48 req/s
- c80: media 51.36ms | p95 75ms | ~1488.1 req/s

Resultado:
- melhoria de ordem de grandeza na latencia e throughput do endpoint KYC.
- em carga de validacao KYC pura, o backend deixa de ser o gargalo principal.

## Observacoes de leitura dos testes
- Nos testes em porta/prod com limitadores ativos, houve 429 em alto volume (esperado pela protecao).
- Nos testes dedicados de benchmark (instancia sem gargalo de rate limit), nao houve 429/timeout relevantes.
- Isso confirma que o timeout visto antes era majoritariamente arquitetura de fluxo + politicas de entrada, nao "limite bruto" do novo endpoint.

## Estado atual para release
- Backend: pronto para KYC leve com processamento principal no app.
- Mobile: onboarding/verify com assinatura/similaridade local e chamada JSON leve.
- Dashboard/Admin: status KYC visivel e controles de aprovacao/reprovacao mantidos.

## Checklist operacional recomendado
- Garantir mesmos envs em VPS (incluindo os 3 de KYC acima).
- Manter `KYC_WRITE_AUDIT_KEY=false` no soft release.
- Subir para `true` apenas quando houver demanda de auditoria expandida.
- Rodar smoke apos deploy:
  - `GET /api/kyc/health`
  - `POST /api/kyc/verify-driver/device` com payload de teste.
- Confirmar TTL no Redis da chave `kyc_verification:{userId}`.

## Risco residual
- Se o app cliente reconectar demais ou repetir verify desnecessariamente, ainda pode gerar pico evitavel.
- Recomendacao: manter 1 sessao socket por usuario e evitar chamadas redundantes de verify no mesmo ciclo de online.

## Conclusao
Para o soft release, o modelo atual de KYC device-first esta adequado e significativamente mais eficiente para a VPS atual. O proximo ganho estrutural vira mais de controle de entrada/churn de cliente do que de compute do KYC no backend.
