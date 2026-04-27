const DEFAULT_API_BASE_URL = 'https://api.62.169.31.231.sslip.io';

const normalizeBaseUrl = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return DEFAULT_API_BASE_URL;
    const withoutTrailingSlash = raw.replace(/\/+$/, '');
    return withoutTrailingSlash.replace(/\/api$/i, '');
};

const legalBaseUrl = normalizeBaseUrl(
    process.env.EXPO_PUBLIC_LEGAL_BASE_URL ||
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    process.env.EXPO_PUBLIC_API_URL ||
    DEFAULT_API_BASE_URL
);

module.exports.AppConfig = {
    app_name: 'Leaf',
    app_description: 'O novo jeito de ir e vir',
    app_identifier: 'br.com.leaf.ride',
    ios_app_version: '1.0.1',
    ios_build_number: '14',
    android_app_version: 105,
    expo_owner: 'leaf-app',
    expo_slug: 'leaf',
    expo_project_id: '91dfdce0-9705-4fde-8417-747273ab7cc2',
    // URLs públicas para políticas legais (obrigatórias para publicação nas lojas)
    privacy_policy_url: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || `${legalBaseUrl}/privacy-policy`,
    terms_of_service_url: process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL || `${legalBaseUrl}/terms-of-service`,
    refund_policy_url: process.env.EXPO_PUBLIC_REFUND_POLICY_URL || `${legalBaseUrl}/refund-policy`,
    account_deletion_url: process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL || `${legalBaseUrl}/account-deletion`,
    support_email: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'suporte@leaf.app.br'
};
