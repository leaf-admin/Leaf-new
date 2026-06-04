# Decisao de Auth e OTP sem reCAPTCHA

Data: 2026-06-04

## Contexto

O Firebase Phone Auth pode exibir reCAPTCHA quando o app e instalado fora do canal da loja, especialmente em APK via `adb`. Esse comportamento nao deve ser tratado como prova final da experiencia de producao Android, porque a verificacao de app muda quando a build vem da Play Store/Internal Testing com Play Integrity e assinaturas corretas.

## Decisao atual

Vamos seguir com modelo hibrido:

1. **Producao e lojas:** manter Firebase Phone Auth como caminho principal enquanto a build Android e validada por Internal Testing.
2. **Review/testes controlados:** manter OTP proprio via backend com Firebase Custom Token apenas para usuarios de teste/review e flags explicitas.
3. **Plano futuro:** migrar para OTP proprio completo somente se o teste pela Play Store continuar exibindo reCAPTCHA ou se o produto exigir controle total de SMS, antifraude e custo.

## Por que nao trocar tudo agora

- Firebase Phone Auth ja cobre parte relevante de antifraude, verificacao de app e entrega de SMS.
- OTP proprio exige provedor SMS/WhatsApp, rate limit por telefone/IP/device, controle de abuso, retry, bloqueio por tentativa e auditoria.
- Migrar antes do teste via Play Internal Testing pode resolver um problema que talvez exista apenas em sideload local.
- A build em revisao/loja nao deve receber alteracao grande de auth sem smoke real.

## Caminho de validacao Android

1. Publicar/usar build pelo Google Play Internal Testing.
2. Instalar no device pela Play Store, nao via `adb`.
3. Rodar login com telefone real.
4. Registrar resultado:
   - sem reCAPTCHA: manter Firebase Phone Auth e fechar o incidente como comportamento de sideload;
   - com reCAPTCHA: revisar SHA-1/SHA-256 no Firebase, Play App Signing, Play Integrity e package `br.com.leaf.ride`;
   - persistindo mesmo com config correta: iniciar migracao de OTP proprio completo.

## Guardas obrigatorios para OTP proprio

Qualquer uso fora de Firebase Phone Auth precisa ter:

- flag explicita de runtime;
- allowlist de telefones review/teste quando for bypass;
- TTL curto do codigo;
- invalidação no primeiro uso;
- rate limit por telefone, IP e device;
- logs sem imprimir OTP em producao;
- Firebase Custom Token gerado apenas depois de validacao aprovada;
- painel/relatorio de falha para suporte.

## Estado atual do backend

O backend ja possui:

- `POST /api/custom-otp/request-otp`;
- `POST /api/custom-otp/verify-otp`;
- normalizacao E.164;
- OTP com TTL de 5 minutos no Redis;
- invalidacao do codigo apos uso;
- bypass controlado por `AUTH_TEST_OTP_BYPASS_*` e `APP_REVIEW`;
- criacao de Firebase Custom Token;
- testes unitarios cobrindo OTP invalido, expirado/reutilizado e bypass de review/teste.

## Riscos mapeados

- **Fraude/SMS bombing:** OTP proprio completo precisa de rate limits mais fortes antes de escala.
- **Custo:** SMS/WhatsApp passa a ser custo Leaf direto, diferente do fluxo Firebase atual.
- **Suporte:** falha de OTP precisa aparecer no dashboard para nao virar atendimento cego.
- **Review:** instrucoes de loja precisam sempre informar o OTP correto dos usuarios de teste.

## Fechamento operacional

Esta decisao fecha o escopo de `LEA-9`: a Leaf mantem Firebase Phone Auth como caminho principal, com OTP proprio apenas como fallback controlado para review/testes enquanto nao houver evidencia de reCAPTCHA em instalacao pela Play.

O `LEA-7` permanece separado como validacao pratica pela Play Internal Testing:

- sem reCAPTCHA pela Play: manter o caminho atual;
- com reCAPTCHA pela Play: revisar SHA-1/SHA-256, Play App Signing, Play Integrity e package `br.com.leaf.ride`;
- persistindo mesmo com configuracao correta: abrir nova execucao para OTP proprio completo com provedor, rate limit e observabilidade.

Nenhuma mudanca de backend, mobile ou build e necessaria para este fechamento.
