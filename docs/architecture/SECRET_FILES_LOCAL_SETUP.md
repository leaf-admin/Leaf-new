# Secret Files Local Setup (2026-03-15)

Arquivos sensíveis devem permanecer locais e nunca versionados.

## Mobile app
- `mobile-app/google-services.json`
- `mobile-app/GoogleService-Info.plist`

Use os templates:
- `mobile-app/google-services.example.json`
- `mobile-app/GoogleService-Info.example.plist`

Comandos:
```bash
cp mobile-app/google-services.example.json mobile-app/google-services.json
cp mobile-app/GoogleService-Info.example.plist mobile-app/GoogleService-Info.plist
```

## Firebase config (workspace)
- `config/firebase/GoogleService-Info.plist`

Template:
- `config/firebase/GoogleService-Info.example.plist`

Comando:
```bash
cp config/firebase/GoogleService-Info.example.plist config/firebase/GoogleService-Info.plist
```

## Backend env local
- `leaf-websocket-backend/config.production.env` (local only, opcional)

Observações:
- Esses arquivos estão no `.gitignore`.
- Se você já tem os arquivos reais, mantenha-os localmente e fora do Git.
