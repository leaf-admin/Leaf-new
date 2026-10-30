# WhatsApp — handoff para o Codex (30/10/2026)

Contexto, não ordem: cada passo de console, segredo, deploy ou OTA precisa da aprovação
do Izaak para aquela ação (AGENTS.md). A ordem completa de ativação está em
`docs/operations/WHATSAPP_SUPPORT_ACTIVATION.md`.

## O que está no ar

- PR #509 (`66a337df2`) mergeado. Substitui o #474, que foi fechado.
- **Backend no Santiago** (deploy em 30/10, 10:15 UTC):
  - rotas `routes/whatsapp-support.js` (webhook `/api/integrations/whatsapp/webhook`) e `/api/custom-otp`;
  - tudo desligado. O webhook responde 503 enquanto `WHATSAPP_META_*` estão vazios.
- **Dashboard no Contabo**: a inbox de suporte já lê as conversas do WhatsApp pela API da Leaf. Fica vazia até a ativação.
- **App**: o código de OTP por WhatsApp está no `main`, atrás de `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP`.
  - **Nenhum OTA foi publicado com ele.** O próximo OTA leva o código com a flag desligada.
  - Ligar exige um OTA com a flag em `eas.json`.
- `WHATSAPP_OTP_MAX_ATTEMPTS` tem padrão 1: um timeout não gera duas mensagens pagas para o mesmo código.

## O que falta (dono)

1. **Izaak, no console da Meta:**
   - registrar o número na Cloud API e confirmar o WABA ID e o Phone Number ID reais. Os IDs observados estão no doc de ativação; não supor;
   - aprovar o template de autenticação `pt_BR` com botão "copiar código";
   - criar o token de sistema permanente (`whatsapp_business_messaging`, `whatsapp_business_management`);
   - informar o app secret e o verify token do webhook;
   - publicar o app e cadastrar a forma de pagamento dos templates.
2. **Com aprovação:**
   - gerar a `AUTH_OTP_HMAC_KEY` (32 bytes ou mais);
   - colocar as variáveis de `leaf-websocket-backend/config/whatsapp-support.env.example` e `whatsapp-otp.env.example` no `/opt/leaf-app/.env` do Santiago;
   - recriar os gateways.
3. **Com aprovação:** publicar os índices de `support_whatsapp_chats` (`config/firebase/firestore.indexes.json`).
4. **Depois do deploy com segredos:**
   - cadastrar o webhook `https://api.leaf.app.br/api/integrations/whatsapp/webhook`;
   - assinar o tópico `messages`;
   - inscrever o app na WABA.
5. **Validar com uma mensagem real** no suporte e um OTP real, enviado a um número do Izaak. Ele digita o código; agentes nunca digitam OTP.
6. **Só então:** OTA com `EXPO_PUBLIC_ENABLE_WHATSAPP_OTP=true` nas versões 1.0.11 e 1.0.12.

## Cuidados

- **Custo:** o template de autenticação é pago por envio. Os limites são 1 pedido a cada 30 s por telefone, 5 por hora por telefone e 20 por hora por IP. O monitor de custo (#505) não cobre a Meta; acompanhar a cobrança no Business Manager.
- **Fallback:** se o backend der 502, 503 ou 504, o app manda o código por SMS do Firebase. Se der 429 (limite), não troca de canal.
- **Celular do suporte:** não excluir a conta do aplicativo WhatsApp do celular antes dos gates do doc de ativação.
