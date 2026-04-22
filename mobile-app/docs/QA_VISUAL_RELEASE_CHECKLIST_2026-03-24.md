# QA Visual + Release Checklist (iOS/Android)

## Referencias principais
- [APP_VALIDATION_MASTER_PLAN_2026-03-25.md](/Users/izaakdias/Documents/Leaf-new/mobile-app/docs/APP_VALIDATION_MASTER_PLAN_2026-03-25.md)
- [APP_ROUTE_STATE_MATRIX_2026-03-25.md](/Users/izaakdias/Documents/Leaf-new/mobile-app/docs/APP_ROUTE_STATE_MATRIX_2026-03-25.md)

## 1) Preparacao
- Build limpa iOS e Android no branch atual.
- Backend apontando para VPS de producao (sem fallback local).
- Dois perfis de teste ativos: 1 passageiro e 1 motorista.
- Simuladores/emuladores lado a lado: passageiro e motorista.

## 2) Verificacao Visual (Design Consistente)

### 2.1 Navegacao e shell
- Header de telas internas com padrao visual unico (botao circular + titulo central).
- Tipografia e espacamento consistentes entre:
  - `Profile`
  - `Settings`
  - `Support`
  - `SupportTicket`
  - `SupportChat`
  - `Help`
  - `About`
- Nenhum texto de prototipo visivel para usuario final.

### 2.2 Passageiro
- Home/mapa: card flutuante, busca de destino, estados de corrida sem sobreposicao visual.
- Fluxo pagamento -> booking: sem tela "travada"/estado inconsistente.
- Suporte: abrir ticket, abrir chat, enviar mensagem, retorno para home sem quebrar layout.

### 2.3 Motorista
- Home/mapa: ganhos do dia + botao online/offline com leitura clara.
- Ativar online/offline sem glitch visual no botao/status.
- Estados de corrida do motorista:
  - Indo embarque
  - Inicio de viagem
  - Em viagem
- Cartoes e banners de conexao legiveis em todos os estados.

## 3) Fluxos Funcionais Criticos
- Login OTP (passageiro e motorista).
- Onboarding motorista (consentimentos e etapas obrigatorias).
- `createBooking` em rede normal e rede com latencia.
- Reabertura do app durante corrida (passageiro e motorista) com reidratacao de estado.
- Envio/recebimento de mensagens no suporte em ticket ativo.

## 4) Resiliencia de Rede
- Alternar Wi-Fi/4G durante corrida e confirmar:
  - App reconecta sozinho.
  - Estado da corrida nao e perdido.
  - Usuario nao fica em erro terminal sem opcao de continuidade.

## 5) Verificacao Store Compliance (Pre-Submission)
- Sem strings de debug/prototipo visiveis.
- Politica de privacidade e termos acessiveis em telas navegaveis.
- Permissoes com texto claro e proporcional ao uso (localizacao, notificacoes).
- Sem links quebrados para paginas legais.
- Fluxo principal completo sem abrir menu de desenvolvimento.

## 6) Evidencias (Obrigatorio)
- Capturas de tela das telas chave de passageiro e motorista.
- Video curto do fluxo ponta a ponta:
  - Login -> Corrida -> Suporte -> Encerramento.
- Registro de versao build, commit/branch e data/hora do teste.

## 7) Gate de Go/No-Go
- Go somente se:
  - 0 bloqueadores visuais criticos.
  - 0 perdas de estado de corrida nos testes de reconexao.
  - 0 erros impeditivos de booking/login/suporte.
- Qualquer falha nesses itens = No-Go ate hotfix e reteste.
