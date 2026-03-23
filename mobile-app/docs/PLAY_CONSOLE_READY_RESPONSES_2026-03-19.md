# Google Play Console - Respostas prontas (Leaf)

Data: 2026-03-19
Escopo: fechamento dos itens obrigatórios de publicação.

## 1) App content > Data safety

### 1.1 Data collection and security
- Coleta ou compartilha dados obrigatórios: `Yes`
- Todos os dados em trânsito usam criptografia: `Yes`
- Existe mecanismo para solicitar exclusão de dados: `Yes`

### 1.2 Data types (selecionar)

Use a matriz abaixo para preencher cada tipo:

| Tipo no Play Console | Coletado | Compartilhado | Obrigatório | Finalidades |
|---|---|---|---|---|
| Location > Precise location | Yes | No | Yes | App functionality, Fraud prevention/security/compliance, Account management |
| Location > Approximate location | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |
| Personal info > Name | Yes | No | Yes | App functionality, Account management, Customer support |
| Personal info > Email address | Yes | No | Yes | App functionality, Account management, Customer support |
| Personal info > Phone number | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > User IDs | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Personal info > Address | Yes | No | Yes | App functionality |
| Personal info > Other info (CPF/cidade motorista) | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |
| Financial info > Purchase history | Yes | No | Yes | App functionality, Account management |
| Photos and videos > Photos | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Files and docs > Files and docs | Yes | No | Yes | App functionality, Account management, Fraud prevention/security/compliance |
| Messages > Other in-app messages | Yes | No | No | App functionality, Customer support |
| App activity > App interactions | Yes | No | No | Analytics, App functionality |
| App info and performance > Diagnostics | Yes | No | No | Analytics |
| Device or other IDs | Yes | No | Yes | App functionality, Fraud prevention/security/compliance |

Notas para manter consistência na revisão:
- `Compartilhado = No` porque os repasses para terceiros ocorrem como processamento por prestadores de serviço (service providers) em nome da Leaf.
- Não marcar finalidades de publicidade/marketing para localização em segundo plano.

## 2) App content > Sensitive app permissions > Location permissions

## 2.1 Feature principal declarada (usar apenas uma)
Use este texto no campo de descrição da funcionalidade:

`Motorista online: a Leaf usa localização em segundo plano para manter a recepção de corridas e atualização de navegação quando o app está minimizado ou fechado. Sem essa permissão, o motorista perde chamadas e não consegue operar continuamente durante o turno.`

## 2.2 Justificativa de necessidade (campo “por que não foreground?”)

`A funcionalidade principal do app para motoristas depende de disponibilidade contínua. O motorista pode estar com tela bloqueada ou alternando apps de navegação. Sem localização em segundo plano, não é possível garantir distribuição de corridas, ETA e segurança operacional em tempo real.`

## 2.3 Prominent in-app disclosure (texto recomendado)

`Este app coleta dados de localização para permitir que você receba corridas e mantenha a navegação ativa mesmo quando o app estiver fechado ou não em uso. A localização em segundo plano é utilizada apenas enquanto você estiver online como motorista, para operação da corrida e segurança. A Leaf não utiliza essa permissão para anúncios.`

## 2.4 Vídeo da declaração (até ~30s)
Checklist do vídeo para aprovação:
- Mostrar o motorista abrindo o app.
- Mostrar o fluxo de ficar online.
- Mostrar o disclosure em tela antes do prompt do Android.
- Mostrar o prompt de permissão de localização.
- Mostrar a funcionalidade ativa com app minimizado/fechado.

Roteiro curto sugerido:
1. Abrir app com conta motorista.
2. Tocar em “Ficar online”.
3. Mostrar modal de disclosure.
4. Conceder permissão de localização.
5. Minimizar app e mostrar que o estado online/recebimento permanece.

## 3) App content > Account deletion
- In-app deletion disponível: `Yes`
- URL externa de exclusão: `https://api.147.182.204.181.sslip.io/account-deletion`

## 4) Checklist final de console (GO publicação)
- Data Safety enviado e sem pendência.
- Declaração de Background Location enviada com vídeo + disclosure.
- URL externa de exclusão cadastrada.
- Política de privacidade pública no listing.

