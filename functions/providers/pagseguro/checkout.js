const axios = require('axios');
const crypto = require('crypto');

class PagSeguroCardProvider {
    constructor() {
        this.baseURL = process.env.PAGSEGURO_BASE_URL || 'https://ws.sandbox.pagseguro.uol.com.br';
        this.email = process.env.PAGSEGURO_EMAIL;
        this.token = process.env.PAGSEGURO_TOKEN;
        this.appId = process.env.PAGSEGURO_APP_ID;
        this.appKey = process.env.PAGSEGURO_APP_KEY;
    }

    // Autenticação via email e token
    getAuthHeaders() {
        return {
            'Content-Type': 'application/xml; charset=UTF-8',
            'Accept': 'application/xml'
        };
    }

    // Criar sessão de pagamento
    async createSession() {
        try {
            const endpoint = '/v2/sessions';
            const params = new URLSearchParams({
                email: this.email,
                token: this.token
            });

            const response = await axios.post(`${this.baseURL}${endpoint}?${params}`, '', {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                sessionId: response.data
            };

        } catch (error) {
            console.error('Erro ao criar sessão PagSeguro:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message
            };
        }
    }

    // Criar transação de cartão
    async createCardTransaction(transactionData) {
        try {
            const endpoint = '/v2/transactions';
            const params = new URLSearchParams({
                email: this.email,
                token: this.token
            });

            // Criar XML da transação
            const xmlData = this.createTransactionXML(transactionData);

            const response = await axios.post(`${this.baseURL}${endpoint}?${params}`, xmlData, {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                data: response.data,
                transactionId: response.data.code,
                status: response.data.status,
                provider: 'pagseguro'
            };

        } catch (error) {
            console.error('Erro ao criar transação PagSeguro:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message,
                provider: 'pagseguro'
            };
        }
    }

    // Criar XML da transação
    createTransactionXML(data) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<checkout>
    <currency>BRL</currency>
    <items>
        <item>
            <id>${data.orderId}</id>
            <description>${data.description || 'Pagamento LEAF App'}</description>
            <amount>${data.amount}</amount>
            <quantity>1</quantity>
        </item>
    </items>
    <reference>${data.reference || data.orderId}</reference>
    <sender>
        <name>${data.customerName || 'Cliente LEAF'}</name>
        <email>${data.customerEmail || 'cliente@leaf.app'}</email>
        <hash>${data.senderHash}</hash>
        <ip>${data.senderIP || '127.0.0.1'}</ip>
        <documents>
            <document>
                <type>CPF</type>
                <value>${data.customerTaxId || '00000000000'}</value>
            </document>
        </documents>
        <phone>
            <areaCode>${data.phoneAreaCode || '11'}</areaCode>
            <number>${data.phoneNumber || '999999999'}</number>
        </phone>
        <address>
            <street>${data.addressStreet || 'Rua Exemplo'}</street>
            <number>${data.addressNumber || '123'}</number>
            <complement>${data.addressComplement || ''}</complement>
            <district>${data.addressDistrict || 'Centro'}</district>
            <city>${data.addressCity || 'São Paulo'}</city>
            <state>${data.addressState || 'SP'}</state>
            <country>BRA</country>
            <postalCode>${data.addressPostalCode || '01001000'}</postalCode>
        </address>
    </sender>
    <shipping>
        <address>
            <street>${data.addressStreet || 'Rua Exemplo'}</street>
            <number>${data.addressNumber || '123'}</number>
            <complement>${data.addressComplement || ''}</complement>
            <district>${data.addressDistrict || 'Centro'}</district>
            <city>${data.addressCity || 'São Paulo'}</city>
            <state>${data.addressState || 'SP'}</state>
            <country>BRA</country>
            <postalCode>${data.addressPostalCode || '01001000'}</postalCode>
        </address>
        <type>3</type>
        <cost>0.00</cost>
    </shipping>
    <payment>
        <mode>default</mode>
        <method>creditCard</method>
        <creditCard>
            <token>${data.cardToken}</token>
            <holder>
                <name>${data.cardHolderName || 'Cliente LEAF'}</name>
                <birthDate>${data.cardHolderBirthDate || '01/01/1990'}</birthDate>
                <documents>
                    <document>
                        <type>CPF</type>
                        <value>${data.customerTaxId || '00000000000'}</value>
                    </document>
                </documents>
                <phone>
                    <areaCode>${data.phoneAreaCode || '11'}</areaCode>
                    <number>${data.phoneNumber || '999999999'}</number>
                </phone>
                <billingAddress>
                    <street>${data.addressStreet || 'Rua Exemplo'}</street>
                    <number>${data.addressNumber || '123'}</number>
                    <complement>${data.addressComplement || ''}</complement>
                    <district>${data.addressDistrict || 'Centro'}</district>
                    <city>${data.addressCity || 'São Paulo'}</city>
                    <state>${data.addressState || 'SP'}</state>
                    <country>BRA</country>
                    <postalCode>${data.addressPostalCode || '01001000'}</postalCode>
                </billingAddress>
            </holder>
        </creditCard>
    </payment>
    <notificationURL>${data.notificationURL || 'https://leaf-app-91dfdce0.cloudfunctions.net/pagseguro-webhook'}</notificationURL>
</checkout>`;
    }

    // Consultar status da transação
    async getTransactionStatus(transactionId) {
        try {
            const endpoint = `/v2/transactions/${transactionId}`;
            const params = new URLSearchParams({
                email: this.email,
                token: this.token
            });

            const response = await axios.get(`${this.baseURL}${endpoint}?${params}`, {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                data: response.data,
                status: response.data.status,
                provider: 'pagseguro'
            };

        } catch (error) {
            console.error('Erro ao consultar transação PagSeguro:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message,
                provider: 'pagseguro'
            };
        }
    }

    // Validar webhook
    validateWebhook(signature, body) {
        try {
            const expectedSignature = crypto
                .createHmac('sha256', this.token)
                .update(body)
                .digest('hex');

            return signature === expectedSignature;
        } catch (error) {
            console.error('Erro ao validar webhook PagSeguro:', error);
            return false;
        }
    }

    // Processar webhook
    processWebhook(webhookData) {
        try {
            const { notificationCode, notificationType } = webhookData;
            
            if (notificationType === 'transaction') {
                return {
                    success: true,
                    notificationCode,
                    provider: 'pagseguro'
                };
            }

            return {
                success: false,
                error: 'Tipo de notificação não reconhecido',
                provider: 'pagseguro'
            };

        } catch (error) {
            console.error('Erro ao processar webhook PagSeguro:', error);
            return {
                success: false,
                error: error.message,
                provider: 'pagseguro'
            };
        }
    }
}

module.exports = PagSeguroCardProvider; 