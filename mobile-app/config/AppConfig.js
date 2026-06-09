const DEFAULT_API_BASE_URL = 'https://api.leaf.app.br';
const DEFAULT_LEGAL_BASE_URL = 'https://leaf.app.br';

const normalizeBaseUrl = (url, fallbackUrl = DEFAULT_API_BASE_URL) => {
    const raw = String(url || '').trim();
    if (!raw) return fallbackUrl;
    const withoutTrailingSlash = raw.replace(/\/+$/, '');
    return withoutTrailingSlash.replace(/\/api$/i, '');
};

const legalBaseUrl = normalizeBaseUrl(
    process.env.EXPO_PUBLIC_LEGAL_BASE_URL ||
    DEFAULT_LEGAL_BASE_URL,
    DEFAULT_LEGAL_BASE_URL
);

module.exports.AppConfig = {
    app_name: 'Leaf',
    app_description: 'O novo jeito de ir e vir',
    app_identifier: 'br.com.leaf.ride',
    ios_app_version: '1.0.2',
    ios_build_number: '24',
    android_app_version: 117,
    expo_owner: 'leaf-app',
    expo_slug: 'leaf',
    expo_project_id: '91dfdce0-9705-4fde-8417-747273ab7cc2',
    // URLs públicas para políticas legais (obrigatórias para publicação nas lojas)
    privacy_policy_url: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || `${legalBaseUrl}/privacy`,
    terms_of_service_url: process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL || `${legalBaseUrl}/terms`,
    refund_policy_url: process.env.EXPO_PUBLIC_REFUND_POLICY_URL || `${legalBaseUrl}/refund-policy`,
    account_deletion_url: process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL || `${legalBaseUrl}/delete-account`,
    support_email: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'suporte@leaf.app.br'
};
