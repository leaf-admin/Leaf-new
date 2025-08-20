import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ptBR } from './locales/pt_BR';

const resources = {
  'pt-BR': ptBR,
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'pt-BR', // Fixar em português brasileiro
    fallbackLng: 'pt-BR',
    compatibilityJSON: 'v3',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

// Garantir que o locale está definido
i18n.locale = 'pt-BR';

export default i18n; 