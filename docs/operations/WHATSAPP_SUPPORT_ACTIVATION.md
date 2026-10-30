# WhatsApp no atendimento — preparação em 26/10/2026

## Objetivo e escopo concluído localmente

Receber mensagens do WhatsApp e responder **texto** no painel de suporte existente.
Código preparado na branch `codex/whatsapp-support-panel-main`, desligado por padrão.
Não houve deploy, configuração de segredos de produção, publicação de índices,
envio real pela API ou exclusão da conta do aplicativo nesta implementação.

O OTP de login por WhatsApp está descrito na seção própria abaixo. No suporte não há
templates, disparos, anexos de saída, download de mídia ou novo worker. Mensagens de mídia
recebidas aparecem com aviso explícito de formato ainda não suportado.

## Evidência da Meta e decisão humana

Na sessão real do Business Suite, o número de atendimento informado por Izaak
apareceu como `Suporte - Leaf`, inicialmente pertencente ao portfólio Izaak Dias.
Depois da remoção desse vínculo e da confirmação do código pelo próprio Izaak,
a interface mostrou propriedade de `Leaf.app` e status `Conectado`.

- Business Portfolio Leaf.app: `2776011785869412`.
- Conta do aplicativo WhatsApp Business observada: `1749560882981205`.
- App Meta criado pelo usuário: `Leaf Atendimento`, ID `1574177414394570`.
- O wizard de produção exibiu referência ao ativo `1059735533436556`;
  **não assumir** que é a WABA final. Confirmar a conta e o Phone Number ID
  após o registro real. IDs de app, portfólio, conta e número não são intercambiáveis.

Izaak escolheu uso exclusivo no painel e aceitou que o histórico não migra para
a API. Isso não significa que o painel esteja publicado ou pronto para receber.
**Não excluir a conta do celular antes dos gates abaixo.**

## Isolamento do trabalho

Durante a implementação, outro trabalho mudou a branch do checkout compartilhado
e o commit `bafae4d85` incluiu parte dos arquivos WhatsApp. Esse commit foi preservado.
A entrega foi copiada para um worktree separado, sem os arquivos RTDB da tarefa
paralela, e em 28/10/2026 reaplicada sobre `origin/main` (`75169be35`). Não reescrever nem reverter o commit paralelo
para integrar esta branch; comparar os arquivos e evitar duplicação de mudanças.

## Fluxo implementado

- `GET /api/integrations/whatsapp/webhook`: challenge Meta com verify token.
- `POST /api/integrations/whatsapp/webhook`: HMAC SHA-256 dos bytes originais,
  limite de 1 MiB, filtro pela WABA e Phone Number ID configurados.
- Persistência transacional em `support_whatsapp_chats/{hash}/messages/{hash}`
  antes do HTTP 200. Reentregas do mesmo ID não incrementam a conversa duas vezes.
- Inbox, histórico, marcar lido, encerrar e responder usam os endpoints Leaf de
  suporte existentes. Contatos têm ID reservado `whatsapp:{phoneNumberId}:{waId}`.
  Nenhuma associação automática a UID, corrida, pagamento ou KYC da Leaf.
- Rotas externas exigem agente autenticado, negam escritas read-only e escopo
  sandbox. Eventos vão somente para o room autenticado do dashboard.
- Respostas são texto livre até 4096 caracteres, dentro de 24h da última mensagem
  do contato. Janela, conversa encerrada e envio pendente são conferidos no backend.
- `Idempotency-Key` identifica a intenção de envio. A reserva é gravada antes da
  chamada à Meta, sem retry automático. O callback opaco permite reconciliar
  status mesmo quando a resposta HTTP se perde. Aceitação não equivale a entrega.
- Um timeout/erro ambíguo mantém o envio pendente e bloqueia novas respostas nessa
  conversa. Não apagar a reserva para tentar novamente sem apurar o envio na Meta.
  Um processo interrompido após reservar também exige essa apuração operacional.
- Conversão automática de contatos externos em ticket fica bloqueada até existir
  um fluxo aprovado de confirmação de identidade; ticket manual segue disponível.

## Ativação: ações separadas com aprovação de Izaak

1. Revisar o diff, os testes e os bloqueios do validador local. Antes de qualquer
   acesso a hosts, ler `SANTIAGO_CUTOVER_RUNBOOK.md`. Deploy segue somente de
   checkout limpo de `main` após revisão/integração da branch.
2. Publicar os dois índices de `support_whatsapp_chats` declarados em
   `config/firebase/firestore.indexes.json` e aguardar estado pronto.
   As regras padrão atuais negam acesso direto do cliente a essa coleção;
   a integração usa Firebase Admin no backend.
3. Implantar backend e dashboard ainda com `WHATSAPP_SUPPORT_ENABLED=false`.
4. Confirmar na Meta a conta de mensagens que receberá o número, as permissões
   mínimas de mensageria e o procedimento de registro. A exclusão da conta do
   aplicativo é irreversível e deve ser feita pelo próprio usuário, somente
   com a migração pronta. Arquivar/exportar conversas importantes previamente;
   o histórico antigo não será importado no painel. Registrar o número na API
   e confirmar WABA ID e Phone Number ID reais. Não usar IDs inferidos do wizard.
5. Provisionar os valores de `config/whatsapp-support.env.example` exclusivamente
   no runtime protegido. Usar segredo de app, verify token dedicado e token de
   acesso com o ativo/permissões corretos. Não colar segredos em chat, repo ou browser
   frontend. Habilitar o canal apenas após configuração completa.
6. Callback pretendido: `https://api.leaf.app.br/api/integrations/whatsapp/webhook`.
   Só cadastrá-lo após implantação e confirmação do challenge. Assinar o tópico
   `messages` e confirmar a assinatura do app na WABA correta.
7. Publicar o app Meta quando os requisitos reais estiverem atendidos: a tela
   observada informou que apps não publicados só recebem webhooks de teste.
   Aprovar separadamente qualquer termo, permissão ou pagamento apresentado.
8. Smoke com sessão real e número autorizado: contato inicia conversa; mensagem
   aparece no painel; agente responde; resposta chega ao telefone; status de
   entrega retorna; repetir webhook não duplica; usuário sem papel de agente
   não lê nem responde; expiração não permite resposta fora da janela.

Sem esses gates, o status é **preparado localmente, ativação pendente**.
Não usar fixtures ou respostas HTTP simuladas como prova de entrega real.

## Validação e limitações

Testes focados usam provider e Firestore simulados e não chamam a Meta. Cobrem
assinatura/bytes originais, autorização, escopo, persistência antes do ack,
duplicidade, timeout, reconciliação, janela de 24h, status e isolamento mobile.

O `config:validate` local falhou com quatro bloqueios fora do canal WhatsApp:
`CPF_REVIEW_HMAC_KEY`, `REDIS_CRITICAL_DATASET_GENERATION`,
`PILOT_ALLOWED_PASSENGER_IDS`, `PILOT_ALLOWED_DRIVER_IDS`. Isso descreve os arquivos
locais carregados pelo comando; não atesta o runtime implantado. Não criar valores
fictícios nem alterar essas políticas para fazer o validador passar.

## Riscos e rollback

- Sem envio real, ainda falta validar token, permissões, número, assinatura,
  webhook, índices, publicação e entrega com o provedor.
- Firestore indisponível retorna 503 para a Meta tentar novamente. Índices ausentes
  impedem listar a inbox; publicar antes de habilitar.
- Rollback do código: desligar `WHATSAPP_SUPPORT_ENABLED`, reverter apenas o diff
  desta tarefa e manter os documentos para auditoria. O webhook fica indisponível;
  registrar a interrupção e a necessidade de reentrega operacional.
- A exclusão da conta no aplicativo não é revertida pelo rollback do código.
  Voltar ao celular exige cancelar o registro na API e seguir o procedimento Meta;
  o histórico perdido não é restaurado pela integração.

Fora do escopo: regras financeiras, corridas, KYC, bots automáticos, campanhas,
templates pagos, novos serviços externos e alterações paralelas no RTDB.

## OTP de cadastro e login por WhatsApp (30/10/2026)

Usa a rota existente `/api/custom-otp` e o `whatsapp-otp-service` (template de
autenticação da Meta com botão de copiar código). Não há fluxo paralelo.

- Backend é a fonte da verdade: código de 6 dígitos com `crypto.randomInt`,
  guardado só como HMAC (`AUTH_OTP_HMAC_KEY`, 32+ bytes) em Redis, validade de
  5 minutos, uso único e no máximo 5 tentativas erradas por código.
- Limites de envio (protegem o custo do template): 1 pedido a cada 30 s por
  telefone, 5 por hora por telefone e 20 por hora por IP. Falha da Meta libera
  o intervalo de 30 s e devolve 502 `WHATSAPP_OTP_DELIVERY_FAILED`.
- Produção só aceita o OTP custom com `AUTH_OTP_PROVIDER=whatsapp`, provedor
  completo e HMAC dedicada; caso contrário segue 503, como antes. Os bypasses de
  teste/review não mudaram.
- App (passageiro e motorista usam o mesmo `PhoneInputStep`/`OTPStep`): liga com
  `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP=true` (OTA). Se o backend responder 502/503/504
  ou não responder, o app envia por SMS do Firebase. Limite (429) não cai para SMS.
- Variáveis: `config/whatsapp-otp.env.example`. O número pode ser o mesmo do
  suporte (`WHATSAPP_SUPPORT_PHONE_NUMBER_ID`), mas os nomes das variáveis são separados.

Ativação, cada passo com aprovação de Izaak: aprovar o template na Meta;
provisionar as variáveis no runtime de Santiago; deploy do backend; smoke com um
número autorizado (sem digitar OTP em celular de QA por agente); só então a OTA
com a flag do app.

## Fontes oficiais consultadas

- [Migração de um número existente](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/migrate-existing-whatsapp-number-to-a-business-account)
- [Coexistência](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Configuração de webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/)
