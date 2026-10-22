# Análise de fraudes em apps de mobilidade e pagamentos: mapa de riscos e mitigação para o Leaf

Data: 2026-10-22
Repositório analisado: `/Users/izaakdias/Documents/leaf-wave` (HEAD `fe43fb441`), somente leitura. Nenhum código foi alterado.
Escopo: backend em `leaf-websocket-backend/`, com referências pontuais a `mobile-app/` e `services/kyc-service/`.

---

## 1. Como ler este documento

- **Cobertura atual** indica o que o código faz hoje, verificado por busca (`rg`) e leitura dos trechos relevantes:
  - **Coberta**: há controle implementado e ligado ao fluxo.
  - **Parcial**: há o controle, mas ele só registra/avisa, não bloqueia, ou cobre só parte do caso.
  - **Não encontrada**: não localizei controle. "Não encontrada" significa que a busca não achou; não prova ausência total. Confirmar antes de decidir.
- **Prioridade para o piloto**:
  - **P0**: fazer antes de ampliar o piloto. Expõe dinheiro, pagamento ou segurança física.
  - **P1**: fazer antes de escala (30 a 60 dias). Reduz perda recorrente.
  - **P2**: depois do piloto, com dados reais.
- Mudanças em regra de negócio (taxa, saque, estorno, pedágio, penalidade automática, bônus) exigem aprovação explícita, conforme `AGENTS.md`. Isto vale para várias mitigações abaixo. Elas estão marcadas com **[aprovação]**.
- Caminhos de arquivo são relativos a `leaf-wave/`.

---

## 2. Resumo executivo

O Leaf já tem uma base sólida em pontos específicos:

- Pagamento Pix confirmado por webhook Woovi com verificação de assinatura antes de a corrida começar.
- Sinais de segurança (`mock_location`, `location_jump`, `kyc_biometric_rejected`) gravados em Redis e enviados ao bot de Segurança, com deduplicação.
- Divergência de posição motorista x passageiro com cancelamento automático e soft ban de 300 s.
- KYC com liveness AWS, face compare com limiar mínimo de 0,95, guardas contra bypass de liveness e limite de 20 sessões AWS por motorista por dia.
- Saque com senha do app, bloqueio após tentativas, chave de idempotência obrigatória, controle de titularidade do telefone e pontuação de risco (step-up).
- CPF único no cadastro, estorno idempotente e reconciliação de ledger.

Os maiores vazios, por risco financeiro e de segurança:

1. **Titularidade da chave Pix de saque** não encontrada: nada indica que a chave pertence ao CPF do motorista.
2. **Sem integridade de dispositivo** (Play Integrity / App Attest) no backend: emulador, root e app clonado não são detectados de forma verificável.
3. **Sinal de GPS simulado só avisa**: a corrida segue, e o campo `accuracy` é declarado pelo próprio cliente.
4. **Pedágio e distância cobrados pela rota** planejada, sem comparação com o rastro real encontrada neste levantamento.
5. **Bônus e indicação sem vínculo de identidade** (CPF, dispositivo, chave Pix): não encontrei limite por pessoa.
6. **Sem dupla aprovação** (maker-checker) para estorno, ajuste de saldo e troca de chave Pix.
7. **Sem cooling-off** após troca de telefone ou de chave Pix antes de saque.
8. **Sem regra de no-show** baseada em chegada verificada, e sem consulta oficial de CNH/CRLV.

---

## 3. Matriz de cobertura

| # | Fraude | Prioridade piloto | Cobertura atual | Arquivo principal |
|---|---|---|---|---|
| 1 | GPS falso e rotas infladas | P0 | Parcial | `services/safety-signal-service.js`, `bootstrap/register-socket-update-location-handler.js` |
| 2 | Corridas fantasma e conluio (bônus) | P0 | Parcial | `services/trip-location-persistence-service.js`, `services/campaign-center-service.js` |
| 3 | Contas múltiplas e de laranjas | P0 | Parcial | `services/cpf-identity-registry-service.js`, `services/account-lifecycle-service.js` |
| 4 | Conta de motorista compartilhada | P1 | Parcial | `services/kyc-policy-service.js`, `services/kyc-driver-status-service.js` |
| 5 | Deepfake e replay no liveness | P0 | Parcial | `services/aws-face-liveness-service.js`, `services/kyc-biometric-production-policy.js`, `services/kyc-failed-biometric-evidence-service.js` |
| 6 | Documentos falsos (CNH, CRLV) | P0 | Parcial | `services/ocr-service.js`, `utils/driver-vehicle-identity.js`, `services/driver-eligibility-service.js` |
| 7 | Chargeback, MED e golpes de Pix | P0 | Parcial | `routes/woovi.js`, `services/authoritative-payment-confirmation-service.js`, `services/payment-service/04-refunds-and-release.js` |
| 8 | Estorno indevido | P0 | Parcial | `services/payment-service/04-refunds-and-release.js`, `scripts/ops/reconcile-financial-ledger.cjs` |
| 9 | Fraude de saque | P0 | Parcial | `routes/payment.js`, `services/kyc-policy-service.js` (`evaluateWithdrawalStepUp`) |
| 10 | Manipulação de tarifa dinâmica | P1 | Parcial | `services/pricing/calculateFare.js`, `services/h3-map-service.js` |
| 11 | Cancelamento para cobrar no-show | P1 | Parcial | `bootstrap/register-socket-cancel-ride-handler.js`, `services/cancellation-credit-pending-service.js` |
| 12 | Pedágio cobrado sem passar | P0 | Parcial | `services/route-toll-service.js` |
| 13 | Roubo de conta (SIM swap, OTP) | P0 | Parcial | `services/whatsapp-otp-service.js`, `routes/auth-otp.js`, `routes/payment.js` |
| 14 | Emulador, root, app clonado | P0 | Não encontrada | Sem attestation no backend |
| 15 | Ataques à API (bots, scraping, enumeração) | P1 | Parcial | `middleware/rateLimiter.js`, `services/rate-limiter-service.js`, `middleware/waf.js` |
| 16 | Golpes contra passageiro e motorista | P0 | Parcial | `services/driver-vehicle-identity.js`, `services/safety-incident-service.js` |
| 17 | Assalto combinado (segurança física) | P0 | Parcial | `services/geofence-service.js`, `services/safety-incident-service.js` |
| 18 | Abuso de cupom e indicação | P0 | Não encontrada | `services/driver-referral-reward-service.js`, `services/referral-program-state-service.js` |
| 19 | Fraude interna (operador) | P0 | Parcial | `middleware/admin-mutation-guard.js`, `services/audit-service.js` |

---

## 4. Controles que já existem (base para as mitigações)

### 4.1 Localização e segurança
- `services/safety-signal-service.js`: tipos `location_jump`, `mock_location` e `kyc_biometric_rejected`, severidade N2. Grava por 30 dias, com índice geral e por motorista. Não bloqueia; avisa o bot de Segurança com evento `safety.signal`. Sandbox é gravado mas não avisa.
- `services/trip-location-persistence-service.js` (`checkLocationJump`): salto é sinal quando distância >= 0,5 km e velocidade implícita > 180 km/h. Ignora pontos com `accuracy` > 200 m.
- `bootstrap/register-socket-update-location-handler.js`: se `data.mocked === true`, registra `mock_location` (deduplicado por motorista, na mesma janela). Não atrasa nem bloqueia o GPS da corrida. O app Android envia o flag (`mobile-app/src/services/LocationBufferService.js`, `BackgroundLocationService.js`).
- `bootstrap/register-socket-trip-integrity-handlers.js`: divergência de posição motorista x passageiro acima de 220 m, com dado recente (até 45 s), em 3 violações consecutivas, cancela a corrida (taxa zero), aplica soft ban de 300 s ao motorista. Timeout de confirmação de 20 s.
- `services/geofence-service.js`: restrição geográfica da corrida, com bypass por variável de ambiente.

### 4.2 Pagamento e ledger
- Webhook Woovi com verificação de assinatura (`routes/woovi.js`, `config/woovi-webhook-public-key.js`).
- `services/authoritative-payment-confirmation-service.js`: confirmação de pagamento autoritativa no servidor.
- Máquina de estados do pagamento (`services/payment-service.js`): `IN_HOLDING`, `DISTRIBUTED`, `REFUNDED`, `CANCELLED`, com `REFUNDED` final.
- `services/payment-service/04-refunds-and-release.js`: `claimRideRefund` idempotente (`refundRequestId`, código `REFUND_ALREADY_IN_PROGRESS`), com aviso aos bots de CFO, Suporte e CTO.
- `services/financial-ledger-service.js`: replay idempotente (`idempotentReplay`). Script de reconciliação `scripts/ops/reconcile-financial-ledger.cjs`.
- `services/cancellation-credit-pending-service.js`: crédito de taxa de cancelamento pendente ao motorista.

### 4.3 KYC e identidade
- `services/kyc-biometric-production-policy.js`: exige liveness AWS (`aws_rekognition_face_liveness`), face compare com limiar mínimo de 0,95, `KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH=true`, bloqueia bypass de liveness sem comparação não-AWS e exige `KYC_AWS_COST_GUARD_ENABLED` com limite de 20 sessões por motorista por dia.
- `services/kyc-failed-biometric-evidence-service.js`: guarda evidência de falha biométrica e recomenda bloqueio permanente quando a revisão confirma fraude (`FRAUD_CONFIRMED`).
- `services/kyc-identity-review-workflow-service.js` e `services/kyc-identity-review-case-service.js`: fluxo de revisão humana.
- `services/cpf-identity-registry-service.js`: CPF único no cadastro (`PROFILE_CPF_ALREADY_REGISTERED`), com índice `cpf_identity_index`.
- `services/kyc-driver-status-service.js` e `services/driver-eligibility-service.js`: gate de ativação por conta, documentos e KYC. Checklist inclui `cnhEar`.
- `services/kyc-service/src/services/anti_spoofing.py` existe no repositório. Não li o conteúdo nesta análise; verificar antes de citar como cobertura.
- `services/device-face-embedding-verification-service.js` existe. Embedding de celular fica desligado por política (`MOBILE_FACE_EMBEDDING_ENABLED=false`) até homologação.

### 4.4 Saque
- `routes/payment.js`: saque protegido por flag de lançamento (`driverWithdrawalsEnabled`), senha do app com validação de dono do telefone (`WITHDRAWAL_PASSWORD_OWNER_MISMATCH`), bloqueio após tentativas (`WITHDRAWAL_PASSWORD_LOCKED`), chave de idempotência obrigatória (`WITHDRAWAL_IDEMPOTENCY_KEY_REQUIRED`), registro de negação (`recordDriverWithdrawalDenial`) e step-up antes do saque.
- `services/kyc-policy-service.js` (`evaluateWithdrawalStepUp`): pontua o saque com sinais de valor (médio: peso 15; alto: peso 22), volume de 24 h projetado acima de R$ 3.000 (`dailyWithdrawalLimitCents=300000`, peso 28), rajada acima de 2 saques em 30 min (peso 22) e KYC não aprovado (bloqueio, peso 100). Retorna requisito de verificação adicional. Não verifiquei nesta análise como o requisito é aplicado ao fluxo do app.
- `services/driver-withdrawal-view.js`: chave Pix mascarada para o motorista.

### 4.5 Operação e API
- `middleware/admin-mutation-guard.js` e `services/audit-service.js`: operador e papel registrados em cada mutação. Se a auditoria obrigatória falha (`AUDIT_WRITE_UNAVAILABLE`), a mutação é recusada.
- `middleware/rateLimiter.js`: limites gerais, de autenticação, de localização, de WebSocket, de pagamento e de status de motorista.
- `services/rate-limiter-service.js`: limites por evento (ex.: `acceptRide` 120, `cancelRide` 20, `searchDrivers` 600, `updateLocation` 2400 por janela), com auditoria de excesso.
- `middleware/waf.js`, `middleware/firebase-user-auth.js`, `middleware/jwt-auth.js`.
- `services/quote-lock-service.js`: trava de cotação.
- `utils/log-redaction.js`: redação de logs.

### 4.6 OTP e conta
- `services/whatsapp-otp-service.js`: máximo de 2 tentativas por envio (limite até 3), com retentativa só para erro retryable.
- `routes/auth-otp.js`: OTP com TTL de 300 s no Redis. Bypass de OTP só com flag explícita e bloqueado em produção sem provedor real. Há um comentário `TODO` na linha 188 sobre integração com WhatsApp; confirmar qual caminho está em produção.
- `services/account-lifecycle-service.js`: exclusão de conta com estado `deletion_pending`/`deleted` e liberação do CPF.

### 4.7 Tarifa e pedágio
- `services/pricing/calculateFare.js`: teto de adicional dinâmico de 40% (`MAX_DYNAMIC_MARKUP_RATE`), valor explícito limitado ao teto, adicional noturno separado.
- `services/route-toll-service.js`: catálogo de praças com direção, classe por tipo de veículo e tarifa por data. Detecção por geometria da rota (tolerância de 2 km para a rota e 0,25 km para o cruzamento).

---

## 5. Análise por tipo de fraude

### 5.1 GPS falso e rotas infladas
**Como funciona.** Motorista usa app de GPS simulado ou hook de localização para aparecer em posições falsas. Usos: acionar corrida sem estar perto, fingir chegada, inflar distância ou tempo, ou fazer um trajeto desviado para aumentar a tarifa por km e minuto. Também existe o caso de "teleporte" no início da corrida.

**Sinais de detecção.**
- Flag `mocked` do Android (já enviado pelo app).
- Velocidade implícita entre pontos consecutivos (acima de 180 km/h).
- Divergência de posição motorista x passageiro (acima de 220 m).
- Movimento sem coerência com acelerômetro ou heading (não temos sensores no servidor).
- Distância percorrida do rastro muito maior que a rota planejada.
- Posição parada durante corrida "em andamento".
- iOS não expõe flag de simulação equivalente. Não há sinal equivalente para iPhone.

**Já existe.** `mock_location` e `location_jump` (ver 4.1). Divergência com cancelamento e soft ban.

**Lacunas.**
- Sinal de `mock_location` não bloqueia nem altera nada. Um motorista pode repetir o sinal indefinidamente.
- `accuracy` é autodeclarada. Um spoofer pode enviar 5 m e nunca ser ignorado pelo filtro de precisão.
- A tarifa usa a rota calculada, não a distância do rastro. Não localizei comparação entre as duas.
- Sem sinal para iOS.

**Mitigação.**
- Prevenção: calcular a tarifa com a rota do servidor e registrar a distância do rastro. Revisar corridas com desvio acima de limiar a calibrar com dados do piloto.
- Detecção: score por motorista. Repetição de `mock_location` em N corridas ou dias gera revisão.
- Resposta: após limiar, suspender dispatch do motorista para revisão humana. **[aprovação]** penalidade automática.
- Não confiar só em `accuracy` e `mocked` do cliente. Usar consistência entre pontos e rastro do servidor.

**Prioridade.** P0.

### 5.2 Corridas fantasma e conluio motorista-passageiro (bônus e promo)
**Como funciona.** Motorista e passageiro (contas próprias, de amigos ou laranjas) criam corridas falsas para completar metas, ganhar bônus por corrida concluída ou gerar cashback. Também serve para circular dinheiro: o passageiro paga Pix, o motorista recebe e saca.

**Sinais.**
- Mesmo CPF, telefone, dispositivo, IP ou chave Pix em motorista e passageiro.
- Corridas com distância do rastro próxima de zero, tempo curto e origem igual ao destino.
- Pares recorrentes com corridas em ambos os sentidos (A para B e B para A).
- Corrida iniciada e encerrada sem movimento.
- Corridas em horários sem demanda real.
- Pagamento Pix de conta de terceiro, diferente do titular.

**Já existe.** Rastro persistido (`trip-location-persistence-service.js`), encerramento antecipado (`ride-early-end-service.js`), reserva de motorista no pagamento (`payment-driver-reservation-service.js`).

**Lacunas.** Não encontrei score de conluio nem grafo de vínculos. Não encontrei regra de corrida mínima para contar em campanha em `campaign-center-service.js`.

**Mitigação.**
- Corrida só conta para bônus se tiver distância mínima do rastro, tempo mínimo e pagamento confirmado.
- Segurar o bônus por D+7 sem cancelamento, estorno ou alerta. **[aprovação]** prazo e regra.
- Detectar pares recorrentes e reciprocidade.
- Grafo de vínculos (ver 5.3).

**Prioridade.** P0 (bônus). Grafo: P1.

### 5.3 Contas múltiplas e de laranjas
**Como funciona.** Uma pessoa cria várias contas de motorista ou de passageiro com CPFs de terceiros. Objetivos: burlar bloqueio, multiplicar promoção, receber saque de outra pessoa ou esconder conta bloqueada.

**Sinais.**
- CPF repetido (bloqueado no cadastro hoje).
- Telefone, e-mail, dispositivo, IP, chave Pix, conta bancária ou placa repetidos entre contas diferentes.
- Embedding facial parecido entre CPFs diferentes.
- Conta criada logo após exclusão de outra.
- Padrão de cadastro em série (mesmo horário, mesmo IP, nomes parecidos).

**Já existe.** CPF único (`cpf-identity-registry-service.js`). Liberação de CPF após exclusão (`account-lifecycle-service.js`), o que permite recriar conta para voltar a receber benefícios.

**Lacunas.** Placa única entre motoristas não encontrada. Telefone, dispositivo e chave Pix vinculados a várias contas não encontrados. Reuso de CPF após exclusão sem período de espera.

**Mitigação.**
- Índice de vínculos (CPF, telefone, dispositivo, chave Pix, placa, conta bancária). Alerta quando duas contas compartilham dois ou mais elementos.
- Placa e chave Pix únicas entre motoristas ativos.
- Período de espera para novo cadastro com o mesmo CPF e para elegibilidade a benefícios.
- Comparação facial 1:N entre contas: **[aprovação]** pelo custo AWS.

**Prioridade.** P0 (chave Pix e placa). Grafo: P1.

### 5.4 Aluguel ou compartilhamento de conta de motorista
**Como funciona.** Motorista aprovado cede a conta a terceiro, que dirige. Também acontece com troca de turno. Quem dirige não passou pelo KYC.

**Sinais.**
- Face da verificação periódica diferente do KYC aprovado.
- Login em dispositivo novo ou que muda de um turno para outro.
- Mesmo login em dois lugares ao mesmo tempo.
- Dispositivo de motorista com localização de outro veículo ou placa diferente da cadastrada.
- Padrão de horário que não bate com o titular.

**Já existe.** KYC com liveness e face compare (ver 4.3). Gate de ativação (`driver-eligibility-service.js`).

**Lacunas.** Não há verificação facial contínua. Não há vínculo de dispositivo. Embedding de celular desligado.

**Mitigação.**
- Verificação facial aleatória ao ficar online (nunca durante corrida, conforme `AGENTS.md`).
- Vínculo de dispositivo e alerta de troca. Troca dispara nova verificação antes de aceitar corrida.
- Bloquear login simultâneo em dois dispositivos.
- **[aprovação]** custo AWS da verificação periódica.

**Prioridade.** P1.

### 5.5 Deepfake e replay no liveness
**Como funciona.** Vídeo pré-gravado ou tela de outro aparelho. Máscara 3D. Injeção de câmera virtual no app (hook ou aparelho comprometido) para enviar vídeo falso ao SDK. Reuso de sessão ou de imagem de documento.

**Sinais.**
- Sessão de liveness reutilizada ou com ID repetido.
- Mesmo rosto em CPFs diferentes (comparação entre contas).
- Score de anti-spoofing baixo ou ausente.
- Aparelho com root, emulador ou câmera virtual (ver 5.14).
- Tempo de sessão anômalo.
- Face compare abaixo de 0,95.

**Já existe.** Liveness AWS, limiar mínimo de 0,95, bloqueio de bypass sem comparação não-AWS, retentativa idempotente com janela de 30 a 150 s, evidência de falha e recomendação de bloqueio em fraude confirmada, serviço `kyc-service` com anti-spoofing (ver 4.3).

**Lacunas.** Não há atestação de integridade do aparelho que comprove que a câmera é real. A checagem de bypass depende de variável de ambiente.

**Mitigação.**
- Confirmar em produção que `KYC_LIVENESS_BYPASS_ENABLED` está desligado (o próprio policy bloqueia configuração insegura).
- Atestação de integridade (5.14) amarrada à sessão de liveness.
- Comparação facial entre contas (5.3).

**Prioridade.** P0 para verificar bypass desligado. Atestação: P1.

### 5.6 Documentos falsos (CNH e CRLV)
**Como funciona.** CNH adulterada, vencida ou com categoria incompatível (sem EAR). CRLV de outro veículo ou placa clonada. Documento de terceiro ou imagem da internet.

**Sinais.**
- Validade da CNH e categoria (EAR) no servidor.
- Nome e CPF do documento x cadastro x face.
- Placa x RENAVAM x CRLV.
- Consulta oficial de situação do veículo e da CNH (Senatran/Detran) não encontrada no código.
- Número de registro repetido entre motoristas.
- Metadados ou sinais de adulteração na imagem.

**Já existe.** OCR de CRLV (`services/ocr-service.js`, `utils/vehicle-ocr-data.js`, fonte `crlv_pdf_ocr` em `utils/driver-vehicle-identity.js`). Checklist de documentos com `cnhEar` (`driver-eligibility-service.js`).

**Lacunas.** Sem consulta oficial. Sem detecção de adulteração de imagem. Placa única não encontrada.

**Mitigação.**
- Validar validade e categoria no backend, com revalidação diária. Documento vencido bloqueia dispatch.
- Placa única entre motoristas ativos.
- Consulta oficial via provedor: **[aprovação]** porque é API paga.
- Revisão humana obrigatória para divergência de nome ou CPF.

**Prioridade.** P0 (validade e placa). Consulta oficial: P1.

### 5.7 Chargeback, MED e golpes de Pix
**Como funciona.** No Pix não existe chargeback clássico. O equivalente é o MED (Mecanismo Especial de Devolução), pedido pelo pagador ao banco dentro do prazo regulatório (cerca de 80 dias; confirmar com a Woovi). Casos:
- Passageiro paga com conta comprometida ou de terceiro e depois contesta. O motorista já recebeu saldo e o Leaf perde.
- Passageiro alega fraude para não pagar.

Golpes de Pix relevantes para o Leaf:
- **Comprovante falso**: motorista ou passageiro mostra comprovante forjado.
- **Pagamento agendado**: Pix agendado que não foi executado.
- **QR trocado**: QR de outra cobrança colado sobre o do app.
- **Pagamento direto ao motorista**: fora do app, sem rastro.

**Sinais.**
- Pagamento confirmado sem `txid` correspondente à corrida.
- Valor ou recebedor diferente do cobrado.
- Contestação (MED) recebida pela Woovi.
- Saldo do motorista ainda não liberado vs contestação dentro do prazo.
- Conta pagadora diferente do titular da conta do passageiro.

**Já existe.** Webhook com assinatura verificada. Confirmação autoritativa no servidor. Corrida só começa após pagamento confirmado (regra de negócio). Máquina de estados com estorno final. Estorno idempotente com aviso aos bots.

**Lacunas.** Não encontrei tratamento de contestação (MED) recebida: fluxo de devolução, reversão de saldo do motorista e registro. Não encontrei regra de retenção de saldo dentro do prazo de contestação.

**Mitigação.**
- Corrida começa só com status confirmado pelo webhook, com `txid` e valor batendo com a corrida. Já é o desenho; confirmar com teste de divergência.
- Runbook de MED: prazo, quem decide, reversão do saldo do motorista (pode gerar saldo negativo; ver ledger).
- Retenção de parte do saldo por janela de contestação. **[aprovação]** regra de saldo e saque.
- Pix agendado não inicia corrida (validar).

**Prioridade.** P0.

### 5.8 Estorno indevido
**Como funciona.** Motorista, passageiro ou operador pede estorno sem direito. Estorno duplicado. Estorno manual sem registro. Ciclo estorno e novo repasse.

**Sinais.**
- Estorno de corrida já concluída e paga.
- Muitos estornos por operador ou por conta.
- Estorno seguido de nova corrida com mesmo par.
- Estorno acima de limiar sem motivo cadastrado.

**Já existe.** Estorno idempotente (`refundRequestId`), bloqueio de estorno concorrente, aviso aos bots, reconciliação de ledger (script manual).

**Lacunas.** Não encontrei dupla aprovação para estorno manual. Reconciliação é script manual, não rotina com alerta.

**Mitigação.**
- Dupla aprovação para estorno acima de limiar. **[aprovação]** valor.
- Motivo obrigatório.
- Reconciliação diária com alerta de divergência.

**Prioridade.** P0.

### 5.9 Fraude de saque
**Como funciona.**
- Sessão do motorista sequestrada, com saque para chave Pix de terceiro.
- Saque em rajada logo após corridas suspeitas (ver 5.2).
- Saque para chave nova ou alterada imediatamente antes.
- Lavagem: corrida fantasma, depois saque.

**Sinais.**
- Chave Pix sem relação com o CPF do motorista.
- Chave alterada nas últimas 24 a 72 h.
- Saque após troca de telefone ou dispositivo.
- Saque logo após corridas com `mock_location` ou divergência.
- Rajada (acima de 2 em 30 min) e volume de 24 h.

**Já existe.** Senha do app com bloqueio, validação de telefone, chave de idempotência, step-up com pontuação (ver 4.4), flag de lançamento, fila de saques para operação.

**Lacunas.**
- **Titularidade da chave Pix não encontrada.** Não há comparação entre a chave e o CPF ou nome do motorista. Confirmar no código de saque e na API Woovi antes de afirmar em definitivo.
- Sem cooling-off para chave nova ou alterada.
- Sem hold de saque após sinal de segurança do motorista.
- Não verifiquei se o requisito do step-up bloqueia de fato o saque.

**Mitigação.**
- Validar que a chave Pix pertence ao CPF do motorista. Se a API do provedor permitir sem custo adicional, usar; senão, **[aprovação]**.
- Cooling-off de 24 a 72 h para saque após alterar chave ou telefone.
- Hold para motorista com `mock_location`, divergência ou rajada.
- Revisão humana para saque acima de limiar.

**Prioridade.** P0.

### 5.10 Manipulação de tarifa dinâmica
**Como funciona.**
- Motoristas desligam o app ao mesmo tempo para subir a pressão e o preço de uma área H3.
- Recusa coordenada de corridas baratas.
- Recusa da primeira oferta, repetida, para forçar aumento.
- Grupos de mensagem coordenando o movimento.
- Lado passageiro: cancelar e refazer a busca para pegar preço menor (scraping de cotação, 5.15).

**Sinais.**
- Queda simultânea de motoristas online em uma célula H3 no mesmo minuto.
- Taxa de recusa alta por célula ou por motorista.
- Ligar e desligar repetidamente (toggle farming).
- Padrão de recusa da primeira oferta.
- Cancelamento de passageiro logo após ver preço.

**Já existe.** Teto de 40% no adicional dinâmico (`calculateFare.js`). Pressão por H3 (`h3-map-service.js`, `pricing-h3-read-model-service.js`). Intenção de offline registrada e rejeitada (`markRideOfflineIntentRejected`). Limite de rejeição por evento (240).

**Lacunas.**
- A pressão usa `pressureGap = activeRequests5m - idleDrivers` (`services/pricing-context-provider.js`, linha 247). `idleDrivers` é disponibilidade declarada pelo próprio motorista, o que permite manipulação.
- Não encontrei detecção de logoff coordenado nem penalidade por recusa coordenada.

**Mitigação.**
- Calcular pressão com demanda observada (buscas e pedidos), não só com motoristas online. Suavizar no tempo.
- Teto por célula e por janela de tempo, além do teto geral.
- Detectar logoff e recusa coordenados por célula e minuto, com alerta à operação.
- Penalidade por recusa acima de limiar. **[aprovação]** regra de penalidade.

**Prioridade.** P1 (P0 se a tarifa dinâmica for ampliada).

### 5.11 Cancelamento para cobrar no-show ou taxa abusiva
**Como funciona.**
- Passageiro cancela depois que o motorista chega, para pagar a taxa.
- Motorista marca chegada falsa e o passageiro cancela, para o motorista receber crédito de taxa.
- Par combinado: cancelamentos repetidos entre as mesmas contas.

**Sinais.**
- Tempo entre aceite e cancelamento.
- Cancelamento após "chegou" sem proximidade GPS do ponto de embarque.
- Proporção de cancelamentos por conta.
- Par recorrente de cancelamento.

**Já existe.** Cálculo canônico da taxa de cancelamento no handler (`register-socket-cancel-ride-handler.js`). Crédito pendente ao motorista (`cancellation-credit-pending-service.js`). Limite de `cancelRide` (20).

**Lacunas.** Não encontrei regra de no-show baseada em chegada verificada por GPS. Não encontrei limite de cancelamento por par.

**Mitigação.**
- Taxa de no-show só após chegada verificada por proximidade do ponto de embarque e tempo mínimo de espera.
- Crédito ao motorista condicionado a chegada verificada.
- Limite de cancelamentos por par e por conta.
- **[aprovação]** regra de taxa.

**Prioridade.** P1.

### 5.12 Pedágio cobrado sem passar
**Como funciona.**
- Passageiro paga pedágio de uma rota planejada que foi desviada e não passou pela praça.
- Motorista escolhe rota com pedágio e não passa, ou exclui praça para economizar.
- Classe de veículo declarada errada para cobrar tarifa maior.
- Manipulação da rota para entrar ou sair da tolerância de 2 km.

**Sinais.**
- Pedágio cobrado sem cruzamento do rastro com a geometria da praça (direção e tolerância de 0,25 km).
- Classe de veículo cobrada diferente do CRLV.
- Diferença entre rota planejada e rastro acima de limiar.

**Já existe.** Catálogo de praças, direção, classe por veículo, tarifa por data, detecção pela geometria da rota (`route-toll-service.js`).

**Lacunas.** A detecção usa a geometria da rota. Não encontrei verificação cruzada com o rastro real. Classe é declarada pelo motorista.

**Mitigação.**
- Cobrar pedágio só se o rastro real cruzou a praça (dentro da tolerância). Pedágio planejado não cruzado é estornado ao passageiro com registro.
- Classe de veículo validada pelo CRLV (5.6).
- Explicitar pedágio no recibo e na reconciliação, como exige a regra de negócio.
- **[aprovação]** regra de cobrança.

**Prioridade.** P0 (é valor repassado de terceiro).

### 5.13 Roubo de conta (SIM swap, OTP WhatsApp, phishing)
**Como funciona.** Golpista troca o chip (SIM swap) ou obtém o OTP por phishing ou engenharia social. Entra na conta, troca telefone ou chave Pix e saca.

**Sinais.**
- Troca de telefone, e-mail ou chave Pix.
- Login em dispositivo novo, em região ou horário incomum.
- Muitas solicitações de OTP para o mesmo número.
- Saque logo após troca de dados.
- Senha de saque errada.

**Já existe.** OTP com TTL de 300 s e até 2 tentativas por envio. Limite de autenticação (`AUTH_LIMIT`). Senha de saque com validação de telefone. Bloqueio de conta (`accountDisabled`).

**Lacunas.**
- Não encontrei alerta de troca de dispositivo ou telefone.
- Não encontrei cooling-off após troca de dados antes do saque.
- Não encontrei limite de OTP por número (além do envio).
- Caminho de OTP em `routes/auth-otp.js` tem `TODO` sobre integração WhatsApp; confirmar o caminho de produção.

**Mitigação.**
- Cooling-off de 24 a 72 h para saque e troca de chave Pix após troca de telefone ou dispositivo.
- Notificar o telefone antigo e o e-mail antigo sobre troca de dados.
- Limite de OTP por número e por IP, com alerta.
- Biometria ou passkey para ações sensíveis do app.

**Prioridade.** P0.

### 5.14 Emuladores, root e apps clonados
**Como funciona.** Motorista roda o app em emulador para automatizar corridas e GPS. Root e hooks (ex.: Frida) alteram localização e dados. App modificado (repackaged) reusa tokens ou contorna regras.

**Sinais.**
- Veredito de integridade (Play Integrity no Android, App Attest no iOS) ausente ou falho.
- Assinatura do APK diferente da de produção.
- Versão do app não suportada.
- Padrão de chamadas de automação (frequência de `updateLocation` e aceite com intervalo fixo).

**Já existe.** Flag `mocked` no Android. Gating de build de simulador no app (`mobile-app/src/config/runtimeAccessPolicy.js`, `Device.isDevice`), que é do lado do cliente e pode ser contornado. Limites de taxa.

**Lacunas.**
- Não encontrei atestação de integridade no backend (busca por Play Integrity, App Attest e integrity sem resultado).
- `mobile-app/src/utils/NetworkUtils.js` (linha 98) retorna `isEmulator: true` para qualquer Android, marcado como "simplificado". Verificar que este valor não é usado para decisão de segurança.

**Mitigação.**
- Atestação no login do motorista e antes de saque. Veredito alimenta score, não bloqueio automático (falso positivo em aparelho antigo).
- Remover ou isolar `isEmulator` de decisões de segurança.
- Padrão de automação (intervalo fixo, sem variação) como sinal de score.

**Prioridade.** P0 para login e saque do motorista. Demais: P1.

### 5.15 Ataques à API (bots, scraping, enumeração)
**Como funciona.**
- Scraping de tarifa e de disponibilidade de motoristas (`searchDrivers`) para mapear demanda e concorrência.
- Enumeração de telefones e contas via OTP ou cadastro.
- Credential stuffing em login.
- Abuso de endpoints de pagamento e de webhook.

**Sinais.**
- Volume de `searchDrivers` por conta ou IP varrendo a cidade por geohash.
- Cadastros em série e OTP por número.
- Requisições sem trace ou com cabeçalhos anômalos.
- Webhook com assinatura inválida em volume.

**Já existe.** Limites em várias camadas (ver 4.5), WAF, autenticação por JWT e Firebase, verificação de assinatura do webhook Woovi, trava de cotação.

**Lacunas.** Não encontrei limite de busca por área, varredura geográfica ou enumeração de contas. Não encontrei verificação de integridade do cliente para o tráfego da API (App Check ou equivalente).

**Mitigação.**
- Limite de `searchDrivers` por conta e por área, com resposta agregada em H3 de resolução menor.
- Limite de OTP por número e IP (5.13).
- Verificação de integridade do cliente (5.14).
- Monitorar taxas de erro de autenticação e de webhook.

**Prioridade.** P1.

### 5.16 Golpes contra passageiro e motorista
**Como funciona.**
- Motorista pede pagamento direto (dinheiro, Pix pessoal) ou cobra "taxa extra" fora do app.
- Falso motorista embarca passageiro em carro diferente do cadastrado.
- Contra motorista: falso passageiro combinado para roubo ou para levar a local isolado.
- Mudança de destino depois do embarque, com pedido de pagamento novo.

**Sinais.**
- Mensagens no chat com termos de pagamento externo ("pix direto", "chave", "dinheiro").
- Placa, modelo ou cor divergentes do cadastro no embarque.
- Destino alterado após embarque.
- Corrida cancelada e refeita com outro preço.
- Ausência de código de confirmação de embarque, se for o caso.

**Já existe.** Placa, modelo e cor exibidos (`utils/driver-vehicle-identity.js`). Pagamento Pix-first, sem dinheiro no carro. Chat na corrida (`register-socket-engagement-chat-handlers.js`). Serviço de incidentes (`safety-incident-service.js`). Playbook de segurança em `docs/operations/`.

**Lacunas.** Não verifiquei nesta análise: código de confirmação de embarque, filtro de termos de pagamento externo no chat e fluxo de botão de emergência (SOS). Verificar antes de marcar como coberto.

**Mitigação.**
- Aviso no app e moderação de termos de pagamento no chat, com bloqueio ou alerta.
- Código de confirmação de embarque, mostrado ao passageiro e digitado pelo motorista (se não existir).
- Alerta quando o destino muda depois do embarque.
- Compartilhamento de trajeto com contato de confiança (verificar se existe).

**Prioridade.** P0.

### 5.17 Assalto combinado (segurança física)
**Como funciona.**
- Passageiro e grupo combinam assalto ao motorista em área isolada.
- Sequestro relâmpago com paradas em caminho deserto.
- Motorista e passageiro combinados para roubar o passageiro.
- Corrida pedida em horário noturno com adicional, em áreas de risco.

**Sinais.**
- Destino ou embarque em área de risco ou fora do padrão de demanda.
- Desvio de rota durante a corrida.
- Parada prolongada fora de ponto de parada previsto.
- Cancelamento após embarque.
- Par com histórico de incidente.
- Conta nova.

**Já existe.** Geofence de corrida (`geofence-service.js`), detecção de salto e divergência, serviço de incidentes, sinais de segurança, modo de destino do motorista (`driver-destination-mode-service.js`), adicional noturno.

**Lacunas.** Não encontrei alerta de parada prolongada nem de desvio de rota durante a corrida. Não verifiquei o fluxo de SOS.

**Mitigação.**
- Alerta de parada prolongada e de desvio, com ação da operação (não automática).
- Restrição de embarque e destino em áreas evitadas (já existe por bairro; manter).
- Histórico de incidente por par e por conta.
- Lembrar: verificação de identidade nunca durante corrida, salvo fluxo de incidente aprovado (`AGENTS.md`).

**Prioridade.** P0.

### 5.18 Abuso de cupom e indicação
**Como funciona.**
- Contas falsas para receber bônus de indicação.
- Autoindicação com contas de terceiro.
- Cupom público compartilhado sem limite.
- Contas laranja que fazem uma corrida (às vezes fantasma) e recebem o bônus.
- Indicação de motorista para bônus de cadastro sem atividade real.

**Sinais.**
- Indicador e indicado com mesmo dispositivo, telefone, chave Pix ou IP.
- Uso de cupom muito rápido após o cadastro.
- Corridas do indicado com rastro ruim ou sem movimento.
- Mesmo padrão de uso de cupom em várias contas.

**Já existe.** Serviços de programa de indicação (`referral-program-state-service.js`, `driver-referral-reward-service.js`) e de campanhas com elegibilidade (`campaign-center-service.js`). Não encontrei checagem de vínculo entre indicador e indicado nesses serviços.

**Lacunas.** Sem limite por CPF, dispositivo ou chave Pix. Sem regra de corrida válida antes da recompensa.

**Mitigação.**
- Recompensa só após corrida válida (pagamento confirmado, rastro com distância mínima, sem cancelamento) e prazo de retenção.
- Bloquear autoindicação por CPF, telefone, dispositivo, chave Pix e IP.
- Limite de uso por pessoa e por dispositivo.
- **[aprovação]** valores e regras de recompensa.

**Prioridade.** P0 (recompensa paga em dinheiro).

### 5.19 Fraude interna (operador do dashboard)
**Como funciona.**
- Operador ajusta saldo, aprova saque próprio ou de conhecido.
- Altera chave Pix de motorista e saca em seguida.
- Estorna sem motivo.
- Acessa dados pessoais ou KYC sem motivo.
- Desativa bloqueio ou verificação.
- Vaza dados.

**Sinais.**
- Ação administrativa fora do horário de turno.
- Alteração de chave Pix seguida de saque.
- Ajuste manual de saldo sem ticket.
- Mesmo operador aprova e executa.
- Acesso em volume a KYC ou dados pessoais.

**Já existe.** Operador e papel registrados em cada mutação (`middleware/admin-mutation-guard.js`). Auditoria obrigatória que recusa mutação se falhar (`audit-service.js`). Papel de pagamento para fila de saque (`requirePaymentAdmin`). Redação de logs (`utils/log-redaction.js`).

**Lacunas.** Não encontrei dupla aprovação (maker-checker). Não encontrei motivo obrigatório para acesso a KYC. Não encontrei alerta de acesso anômalo.

**Mitigação.**
- Dupla aprovação para ajuste de saldo, troca de chave Pix, estorno acima de limiar e saque manual.
- Motivo e ticket obrigatórios para acesso a KYC e dados pessoais.
- Relatório diário de ações sensíveis com alerta.
- Privilégio mínimo por papel e revisão trimestral.

**Prioridade.** P0.

---

## 6. Outros riscos (fora dos 19 pedidos)

- **Lavagem de dinheiro e PLD**: fracionamento de Pix abaixo de limites, circulação entre contas do mesmo grupo. Exige rotina de monitoramento e processo de comunicação ao COAF. **P1**, com revisão jurídica. Não há monitoramento de PLD encontrado.
- **Cartão roubado**: reduzido pelo modelo Pix-first. Se cartão for aceito no futuro, vira risco P0.
- **Fraude de sinistro**: acidente ou dano falsos com seguro. **P2**.
- **Dados sensíveis (LGPD)**: biometria e documentos são dados sensíveis. Retenção e acesso devem ser limitados. Ver 5.19.

---

## 7. Comparativo Brasil x outros mercados

| Tema | Fora do Brasil (EUA, Europa) | Brasil (Pix e contexto local) |
|---|---|---|
| Pagamento | Cartão roubado, chargeback de "cliente de boa-fé" | MED, golpe de Pix, conta laranja |
| Conta | Compartilhamento de conta, clonagem de identidade | SIM swap e OTP por WhatsApp como porta de entrada |
| Cadastro | Verificação de CNH por provedor | CNH e CRLV com OCR e consulta oficial a validar |
| Golpe contra motorista | Passageiro falso para roubo | Mesmo padrão, com carro e área de risco específicos |
| Regulação | Regras de chargeback e KYC | PLD, COAF, LGPD para biometria |

---

## 8. Plano priorizado

### 8.1 Próximos 30 dias (antes de ampliar o piloto)

1. **Titularidade da chave Pix no saque** (5.9). Confirmar no código de saque e na API Woovi. Bloquear saque para chave que não pertence ao CPF do motorista. P0.
2. **Cooling-off de saque** após troca de telefone, dispositivo ou chave Pix (5.9, 5.13). 24 a 72 h. **[aprovação]**. P0.
3. **Dupla aprovação** para estorno acima de limiar, ajuste de saldo, troca de chave Pix e saque manual (5.8, 5.19). P0.
4. **Runbook de MED** e regra de retenção de saldo dentro do prazo de contestação (5.7). **[aprovação]**. P0.
5. **Pedágio cobrado só se o rastro cruzou a praça** (5.12). Divergência estornada com registro. **[aprovação]**. P0.
6. **Recompensa de indicação e bônus só após corrida válida**, com prazo de retenção e bloqueio de autoindicação (5.2, 5.18). **[aprovação]** valores. P0.
7. **Verificar que o bypass de liveness está desligado em produção** e registrar a evidência (5.5). P0.
8. **Validade de CNH e categoria EAR no backend**, com revalidação diária. Placa única entre motoristas ativos (5.3, 5.6). P0.
9. **Alerta de rota x rastro** para tarifa: registrar distância do rastro e comparar com a rota (5.1). Começar em modo de sinal, sem bloqueio. P0.
10. **Confirmar fluxos de embarque, SOS e chat** (5.16, 5.17). Se faltar, código de embarque e moderação de termos de pagamento. P0.
11. **Sinal de desvio e parada prolongada** durante corrida, para a operação (5.17). P0.

### 8.2 Dias 31 a 60 (antes de escala)

1. **Grafo de vínculos** (CPF, telefone, dispositivo, chave Pix, placa, conta) com alerta de contas que compartilham dois ou mais elementos (5.2, 5.3). P1.
2. **Atestação de integridade** (Play Integrity no Android, App Attest no iOS) no login e antes de saque, como sinal de score (5.14, 5.5). P1.
3. **Vínculo de dispositivo** e alerta de troca, com nova verificação antes de aceitar corrida (5.4). P1.
4. **Verificação facial periódica** ao ficar online, fora de corrida (5.4). **[aprovação]** custo AWS. P1.
5. **Consulta oficial de CRLV e CNH** por provedor (5.6). **[aprovação]** custo. P1.
6. **Pressão de tarifa com demanda observada**, teto por célula e alerta de logoff coordenado (5.10). P1.
7. **Taxa de no-show com chegada verificada** por GPS (5.11). **[aprovação]**. P1.
8. **Limites de busca por área e de OTP por número** (5.13, 5.15). P1.
9. **Remover ou isolar `isEmulator`** de decisões de segurança (5.14). P1.
10. **Reconciliação diária de ledger** com alerta de divergência (5.8). P1.

### 8.3 Dias 61 a 90 (maturidade)

1. **Score de risco por motorista e passageiro**, em modo sombra primeiro, com revisão de falsos positivos (todas as seções). P1 a P2.
2. **Rotina de PLD** (fracionamento, circulação entre contas, comunicação ao COAF) com revisão jurídica (seção 6). P1.
3. **Playbooks de resposta** para cada tipo P0, com exercício de simulação (seção 8.1). P1.
4. **Trilha de auditoria e revisão trimestral de privilégio** dos operadores (5.19). P1.
5. **Teste de intrusão na API e nos webhooks** (5.15). P2.
6. **Revisão de retenção de dados biométricos e documentos** (seção 6, LGPD). P1.
7. **Medir taxa de fraude por tipo** no piloto e priorizar com dados reais. P2.

---

## 9. Limitações desta análise

- Análise de código por `rg` e leitura de trechos. Não rodei testes nem consultei produção.
- "Não encontrada" indica que a busca não achou o controle, não que ele não existe. Antes de priorizar, confirmar nos serviços citados.
- Não li em profundidade `mobile-app/` nem `services/kyc-service/` (anti-spoofing).
- Valores de limite citados vêm de variáveis de ambiente com padrão; o valor em produção pode diferir.
- Prazo do MED e exigências de PLD devem ser confirmados com a Woovi e com a área jurídica.
- Nenhum item deste documento autoriza mudança de regra de negócio, custo com API paga ou alteração de produção sem aprovação explícita.

---

## 10. Próximo passo sugerido

Validar os cinco itens P0 de maior impacto financeiro (titularidade da chave Pix, cooling-off de saque, dupla aprovação, runbook de MED e pedágio por rastro) com um teste de regressão por item, antes de qualquer mudança de código. Os itens que mudam regra de negócio dependem de aprovação do Izaak.
