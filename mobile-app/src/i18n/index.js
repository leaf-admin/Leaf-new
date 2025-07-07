import i18n from 'i18n-js';
import translationsEn from '@json/language-en.json';
import translationsPtBr from '@json/language-pt-br.json';

console.log('i18n - Carregando traduções...');
console.log('i18n - Traduções PT-BR:', Object.keys(translationsPtBr).length, 'chaves');
console.log('i18n - Traduções EN:', Object.keys(translationsEn).length, 'chaves');

// Configure i18n
i18n.translations = {
  'pt-BR': translationsPtBr,
  'pt': translationsPtBr,
  'pt-br': translationsPtBr,
  'en': translationsEn,
  'en-US': translationsEn,
  default: translationsPtBr
};

i18n.fallbacks = true;
i18n.defaultLocale = 'pt-BR';
i18n.locale = 'pt-BR';

console.log('i18n - Configuração finalizada. Locale:', i18n.locale);

// Missing translation handler
i18n.missingTranslation = (scope, options) => {
  console.warn(`Missing translation for key: ${scope}`);
  return `Missing: ${scope}`;
};

export default i18n; 