# Google Play Console - Respostas prontas (Leaf)

Data: 2026-03-23  
Escopo: preenchimento final de `App content` para submissão.

## 1) App content > Data safety

### 1.1 Data collection and security
- Coleta ou compartilha dados obrigatórios: `Yes`
- Todos os dados em trânsito usam criptografia: `Yes`
- Existe mecanismo para solicitar exclusão de dados: `Yes`

### 1.2 Data types (matriz sugerida)

| Tipo no Play Console | Coletado | Compartilhado | Obrigatório | Finalidades |
|---|---|---|---|---|
| Location > Precise location | Yes | No | Yes | App functionality, Fraud prevention/security/compliance, Account management |
| Location > Approximate location | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |
| Personal info > Name | Yes | No | Yes | App functionality, Account management, Customer support |
| Personal info > Email address | Yes | No | Yes | App functionality, Account management, Customer support |
| Personal info > Phone number | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > User IDs | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > Address | Yes | No | Yes | App functionality |
| Personal info > Other info (CPF/dados de motorista) | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |
| Financial info > Purchase history | Yes | No | Yes | App functionality, Account management |
| Photos and videos > Photos | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Files and docs > Files and docs | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Messages > Other in-app messages | Yes | No | No | App functionality, Customer support |
| App activity > App interactions | Yes | No | No | Analytics, App functionality |
| App info and performance > Diagnostics | Yes | No | No | Analytics |
| Device or other IDs | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |

Notas:
- `Compartilhado = No` para data safety quando o processamento é por prestadores em nome da Leaf.
- Não marcar publicidade/ads para localização.

## 2) App content > Sensitive permissions > Location

### 2.1 Feature principal (texto sugerido)
`Motorista online: a Leaf usa localização em segundo plano para manter recepção de corridas e atualização de navegação quando o app está minimizado. Sem essa permissão, o motorista perde chamadas e não consegue operar continuamente durante o turno.`

### 2.2 Por que foreground não é suficiente
`A operação de motorista exige disponibilidade contínua, inclusive com tela bloqueada e alternância entre apps de navegação. Sem localização em segundo plano, não é possível manter distribuição de corridas, ETA e segurança operacional em tempo real.`

### 2.3 Prominent disclosure (copiar no formulário)
`Este app coleta dados de localização para permitir que você receba corridas e mantenha a navegação ativa mesmo quando o app não está em uso. A localização em segundo plano é usada somente enquanto você estiver online como motorista, para operação da corrida e segurança. A Leaf não usa essa permissão para anúncios.`

### 2.4 Vídeo de evidência (roteiro curto)
1. Login com conta de motorista.
2. Tocar em “Ficar online”.
3. Mostrar disclosure antes da permissão.
4. Conceder permissão de localização.
5. Minimizar app e mostrar continuidade operacional.

## 3) App content > Account deletion
- In-app deletion disponível: `Yes`
- URL externa de exclusão: `https://api.147.182.204.181.sslip.io/account-deletion`

## 4) Checklist de envio no Play Console
- [ ] Data Safety enviado sem pendência.
- [ ] Declaração de background location enviada com vídeo.
- [ ] URL externa de exclusão cadastrada.
- [ ] Política de privacidade pública no listing.
