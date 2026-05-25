# Playbook de Fechamento de Console (Apple + Google)

Data: 2026-03-19
Objetivo: fechar os últimos bloqueadores manuais de publicação.

## 1) Google Play Console

### 1.1 Data Safety (obrigatório)
- Status atual: PENDENTE
- Caminho: `App content` > `Data safety`.
- Marcar coleta/uso conforme implementação atual:
  - Localização (foreground e background para motorista online)
  - Identificadores de conta (telefone, UID)
  - Dados de contato (nome, e-mail)
  - Documentos do motorista (CNH/CRLV/biometria)
  - Diagnóstico básico e notificações
- Confirmar finalidade: operação do serviço, segurança/fraude, suporte, comunicações transacionais.

### 1.2 Background location declaration (obrigatório)
- Status atual: PENDENTE
- Caminho: `App content` > `Sensitive permissions` > `Location`.
- Declarar uso de `ACCESS_BACKGROUND_LOCATION` para motorista receber corrida e navegação com app minimizado.
- Anexar evidências:
  - Tela de disclosure antes do prompt (modal explicativo)
  - Fluxo onde a permissão é solicitada apenas quando motorista fica online

### 1.3 Account deletion URL externa (obrigatório)
- Status atual: PENDENTE
- Caminho: `App content` > `Account deletion`.
- URL para informar: `https://api.147.182.204.181.sslip.io/account-deletion`
- Confirmar que o app também oferece exclusão in-app (já implementado).

## 2) App Store Connect

### 2.1 Links legais públicos
- Status atual: TECNICAMENTE RESOLVIDO (validar preenchimento no record final)
- Privacy Policy URL: `https://api.147.182.204.181.sslip.io/privacy-policy`
- Terms URL (campo de marketing/compliance, se disponível no app record): `https://api.147.182.204.181.sslip.io/terms-of-service`

### 2.2 App Privacy (Nutrition Labels)
- Status atual: PENDENTE DE CONSOLE
- Preencher coleta de dados em linha com o Data Safety da Play.
- Garantir consistência com os textos de permissão no app.

## 3) Evidências técnicas já prontas
- `targetSdkVersion=36` no manifesto release merged.
- iOS ATS hardened (`NSAllowsArbitraryLoads=false`, sem exceções de HTTP por padrão).
- Android cleartext bloqueado em produção por padrão.
- Fluxo de exclusão de conta ativo em endpoint autenticado.
- Páginas públicas: privacidade, termos e exclusão em `200 OK`.

## 4) Status final
- Código: pronto para build de release.
- Publicação em loja: NO-GO até concluir os 3 itens obrigatórios no Google Play Console e a revisão final de metadata/privacy no App Store Connect.
