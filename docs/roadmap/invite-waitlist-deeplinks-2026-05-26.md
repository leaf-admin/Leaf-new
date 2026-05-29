# Convites e Waitlist - Deep Links Publicos

Data: 2026-05-26

## Objetivo

Deixar pronta a camada publica de convites para passageiro e motorista antes da entrada em producao:

- `https://leaf.app.br/convite/:code`
- `https://leaf.app.br/motorista/convite/:code`

Esses links devem abrir o app quando instalado e exibir uma pagina web limpa quando o app ainda nao estiver no aparelho.

## Entregue

- Pagina web de convite de passageiro em `landing-page/convite/index.html`.
- Pagina web de convite de motorista em `landing-page/motorista/convite/index.html`.
- Script compartilhado `landing-page/assets/invite-link.js` que:
  - le o codigo pela URL;
  - tenta abrir o app via scheme;
  - consulta preview publico do convite sem PII;
  - mostra fallback para instalar/abrir o app.
- CSS compartilhado `landing-page/assets/invite-link.css`.
- Rewrite Cloudflare Pages em `landing-page/_redirects`.
- Fallback Apache em `landing-page/.htaccess`.
- `apple-app-site-association` para Universal Links iOS.
- `assetlinks.json` para Android App Links com o fingerprint do APK release local atual.
- Entitlement iOS `com.apple.developer.associated-domains` em `mobile-app/ios/Leaf/Leaf.entitlements`.
- Endpoint publico sanitizado:
  - `GET /api/programs/referrals/invites/public/:code`
  - nao retorna `inviterId`, `inviteeId`, telefone, email ou `acceptedBy`.

## Contrato publico do endpoint

Passageiro:

```json
{
  "success": true,
  "invite": {
    "code": "PSG-ABC",
    "kind": "passenger",
    "status": "pending",
    "canAccept": true,
    "message": "Convite ativo",
    "passengerBenefit": {
      "discountPercent": 10,
      "maxDiscountRides": 3,
      "nonCumulative": true
    }
  }
}
```

Motorista:

```json
{
  "success": true,
  "invite": {
    "code": "DRV-ABC",
    "kind": "driver",
    "status": "pending",
    "canAccept": true,
    "message": "Convite ativo",
    "driverReward": {
      "requiredCompletedTrips": 20,
      "rewardMonths": 1,
      "qualificationWindowDays": 30
    }
  }
}
```

## Flags

- `ENABLE_REFERRAL_PROGRAMS=true`: libera as rotas de programas.
- `ENABLE_ADMIN_MUTATIONS=true`: libera mutacoes administrativas no dashboard.
- `REFERRAL_PUBLIC_LOOKUP_RATE_LIMIT=80`: limite padrao por IP a cada 15 minutos para lookup publico.

## Checklist de producao

1. Publicar `landing-page` na Cloudflare Pages incluindo `_redirects` e `.well-known`.
2. Confirmar que `https://leaf.app.br/.well-known/apple-app-site-association` responde `200` sem redirect e com JSON valido.
3. Confirmar que `https://leaf.app.br/.well-known/assetlinks.json` responde `200` sem redirect e com JSON valido.
4. Se o Google Play App Signing for ativado, adicionar tambem o fingerprint do certificado de assinatura da Play em `assetlinks.json`.
5. Confirmar no Apple Developer que o App ID `DTA8W5KA5D.br.com.leaf.ride` tem Associated Domains habilitado antes da proxima build App Store.
6. Testar em aparelho:
   - abrir `https://leaf.app.br/convite/PSG-TESTE`;
   - abrir `https://leaf.app.br/motorista/convite/DRV-TESTE`;
   - aceitar o codigo no app logado;
   - validar que codigo ja aceito nao pode ser aceito novamente.

## Observacoes

- O link de Google Play usa o package final `br.com.leaf.ride`.
- O fallback iOS ainda aponta para `https://leaf.app.br/` ate termos o App Store ID publico definitivo.
