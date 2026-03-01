// Configuração para Google Auth
// Substitua pelos seus próprios Client IDs do Google Cloud Console

export const GOOGLE_AUTH_CONFIG = {
  // Client ID para Expo Go (desenvolvimento)
  expoClientId: 'YOUR_EXPO_CLIENT_ID.apps.googleusercontent.com',
  
  // Client ID para iOS
  iosClientId: 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com',
  
  // Client ID para Android
  androidClientId: 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com',
  
  // Client ID para Web (se necessário)
  webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
};

// Instruções para configurar:
// 1. Acesse https://console.cloud.google.com/
// 2. Crie um novo projeto ou selecione um existente
// 3. Ative a Google+ API
// 4. Vá em "Credenciais" e crie credenciais OAuth 2.0
// 5. Configure os URIs de redirecionamento:
//    - Para Expo: https://auth.expo.io/@your-username/your-app-slug
//    - Para iOS: com.yourcompany.yourapp://
//    - Para Android: com.yourcompany.yourapp://
// 6. Substitua os Client IDs acima pelos gerados 