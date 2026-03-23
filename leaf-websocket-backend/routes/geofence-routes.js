const express = require('express');
const router = express.Router();
const geofenceService = require('../services/geofence-service');
const { logStructured, logError } = require('../utils/logger');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');

let firebaseConfig = null;
try {
    firebaseConfig = require('../firebase-config');
} catch (error) {
    logStructured('warn', 'Firebase config indisponivel para geofence-routes', {
        service: 'geofence-routes',
        error: error.message
    });
}

const ADMIN_ROLES = ['admin', 'super-admin', 'manager'];
const CITY_ACTIVATION_DB_PATH = 'operations/geography/cityActivation';
const GEOFENCE_ADMIN_DB_PATH = 'operations/geography/geofenceConfig';
const DEFAULT_MAX_ACTIVE_DRIVERS_PER_CITY = Number.parseInt(
    process.env.DEFAULT_MAX_ACTIVE_DRIVERS_PER_CITY || '300',
    10
);

const DEFAULT_RJ_CITIES = [
    { name: 'Rio de Janeiro', value: 'rio-de-janeiro-rj', active: true, priority: 1, maxActiveDrivers: 600, waitlistEnabled: true },
    { name: 'Niteroi', value: 'niteroi-rj', active: true, priority: 2, maxActiveDrivers: 220, waitlistEnabled: true },
    { name: 'Sao Goncalo', value: 'sao-goncalo-rj', active: false, priority: 3, maxActiveDrivers: 180, waitlistEnabled: true },
    { name: 'Duque de Caxias', value: 'duque-de-caxias-rj', active: false, priority: 4, maxActiveDrivers: 180, waitlistEnabled: true },
    { name: 'Nova Iguacu', value: 'nova-iguacu-rj', active: false, priority: 5, maxActiveDrivers: 170, waitlistEnabled: true },
    { name: 'Belford Roxo', value: 'belford-roxo-rj', active: false, priority: 6, maxActiveDrivers: 120, waitlistEnabled: true },
    { name: 'Sao Joao de Meriti', value: 'sao-joao-de-meriti-rj', active: false, priority: 7, maxActiveDrivers: 110, waitlistEnabled: true },
    { name: 'Petropolis', value: 'petropolis-rj', active: false, priority: 8, maxActiveDrivers: 140, waitlistEnabled: true },
    { name: 'Volta Redonda', value: 'volta-redonda-rj', active: false, priority: 9, maxActiveDrivers: 130, waitlistEnabled: true },
    { name: 'Campos dos Goytacazes', value: 'campos-dos-goytacazes-rj', active: false, priority: 10, maxActiveDrivers: 125, waitlistEnabled: true }
];

let inMemoryCityActivationConfig = null;
let inMemoryGeofenceAdminConfig = null;

function getRealtimeDB() {
    if (!firebaseConfig || typeof firebaseConfig.getRealtimeDB !== 'function') {
        return null;
    }
    return firebaseConfig.getRealtimeDB();
}

function normalizeStateCode(value) {
    return String(value || '').trim().toUpperCase();
}

function slugify(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getDefaultGeofenceAdminConfig() {
    return {
        version: 1,
        enabled: geofenceService.isEnabled(),
        region: geofenceService.getCurrentRegion() || [],
        updatedAt: null,
        updatedBy: null
    };
}

function normalizeGeofenceAdminConfig(rawConfig) {
    const defaults = getDefaultGeofenceAdminConfig();
    return {
        version: Number(rawConfig?.version || defaults.version || 1),
        enabled: typeof rawConfig?.enabled === 'boolean' ? rawConfig.enabled : defaults.enabled,
        region: Array.isArray(rawConfig?.region) ? rawConfig.region : defaults.region,
        updatedAt: rawConfig?.updatedAt || defaults.updatedAt,
        updatedBy: rawConfig?.updatedBy || defaults.updatedBy
    };
}

function applyGeofenceAdminConfig(configToApply) {
    const config = normalizeGeofenceAdminConfig(configToApply);

    if (Array.isArray(config.region) && config.region.length > 0) {
        const updated = geofenceService.updateRegion(config.region);
        if (!updated) {
            logStructured('warn', 'Regiao de geofence invalida no config admin, mantendo regiao atual', {
                service: 'geofence-routes'
            });
        }
    }

    const currentRegion = geofenceService.getCurrentRegion() || [];
    config.region = currentRegion;

    if (typeof config.enabled === 'boolean') {
        geofenceService.setEnabled(config.enabled);
    } else {
        config.enabled = geofenceService.isEnabled();
    }

    return config;
}

function buildGeofenceResponse(config) {
    const currentRegion = geofenceService.getCurrentRegion() || [];

    return {
        version: Number(config?.version || 1),
        enabled: geofenceService.isEnabled(),
        active: geofenceService.isActive(),
        bypassEnabled: geofenceService.isBypassEnabled(),
        regionPoints: Array.isArray(currentRegion) ? currentRegion.length : 0,
        region: currentRegion,
        updatedAt: config?.updatedAt || null,
        updatedBy: config?.updatedBy || null
    };
}

function buildDefaultConfig() {
    const rjCities = {};
    DEFAULT_RJ_CITIES.forEach((city) => {
        const cityKey = slugify(city.value || city.name);
        rjCities[cityKey] = {
            key: cityKey,
            name: city.name,
            value: city.value,
            label: `${city.name} - RJ`,
            stateCode: 'RJ',
            active: Boolean(city.active),
            priority: Number(city.priority || 0),
            maxActiveDrivers: Number(city.maxActiveDrivers || DEFAULT_MAX_ACTIVE_DRIVERS_PER_CITY),
            waitlistEnabled: city.waitlistEnabled !== false
        };
    });

    return {
        version: 1,
        updatedAt: null,
        updatedBy: null,
        states: {
            RJ: {
                stateCode: 'RJ',
                name: 'Rio de Janeiro',
                enabled: true,
                cities: rjCities
            }
        }
    };
}

function normalizeCityRecord(cityKey, cityData, stateCode) {
    const fallbackName = (cityData && cityData.name) || cityKey;
    const name = String(fallbackName || '').trim();
    const safeState = normalizeStateCode(stateCode);
    const computedValue = slugify(cityData?.value || cityData?.slug || cityKey || `${name}-${safeState}`);
    const label = cityData?.label || `${name} - ${safeState}`;

    return {
        key: slugify(cityKey || computedValue),
        name,
        value: computedValue,
        label,
        stateCode: safeState,
        active: Boolean(cityData?.active),
        priority: Number.isFinite(Number(cityData?.priority)) ? Number(cityData.priority) : 999,
        maxActiveDrivers: Number.isFinite(Number(cityData?.maxActiveDrivers))
            ? Number(cityData.maxActiveDrivers)
            : DEFAULT_MAX_ACTIVE_DRIVERS_PER_CITY,
        waitlistEnabled: cityData?.waitlistEnabled !== false
    };
}

function normalizeConfig(rawConfig) {
    const defaultConfig = buildDefaultConfig();
    const mergedStates = {};
    const rawStates = (rawConfig && rawConfig.states && typeof rawConfig.states === 'object')
        ? rawConfig.states
        : {};

    const allStateEntries = {
        ...defaultConfig.states,
        ...rawStates
    };

    Object.entries(allStateEntries).forEach(([stateKey, stateData]) => {
        const stateCode = normalizeStateCode(stateData?.stateCode || stateKey);
        if (!stateCode) return;

        const defaultState = defaultConfig.states[stateCode] || {};
        const rawCities = (stateData && stateData.cities && typeof stateData.cities === 'object')
            ? stateData.cities
            : {};
        const defaultCities = (defaultState && defaultState.cities && typeof defaultState.cities === 'object')
            ? defaultState.cities
            : {};

        const mergedCities = {};
        const allCityEntries = {
            ...defaultCities,
            ...rawCities
        };

        Object.entries(allCityEntries).forEach(([cityKey, cityData]) => {
            const normalized = normalizeCityRecord(cityKey, cityData, stateCode);
            if (!normalized.key) return;
            mergedCities[normalized.key] = normalized;
        });

        mergedStates[stateCode] = {
            stateCode,
            name: stateData?.name || defaultState.name || stateCode,
            enabled: stateData?.enabled !== false,
            cities: mergedCities
        };
    });

    return {
        version: Number(rawConfig?.version || defaultConfig.version || 1),
        updatedAt: rawConfig?.updatedAt || null,
        updatedBy: rawConfig?.updatedBy || null,
        states: mergedStates
    };
}

function buildConfigResponse(cityActivationConfig) {
    const states = Object.values(cityActivationConfig.states || {})
        .map((state) => {
            const cityRows = Object.values(state.cities || {})
                .sort((a, b) => {
                    const byPriority = Number(a.priority || 999) - Number(b.priority || 999);
                    if (byPriority !== 0) return byPriority;
                    return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
                });

            const activeCities = cityRows.filter((city) => city.active).length;
            const totalCapacity = cityRows.reduce(
                (sum, city) => sum + Number(city.maxActiveDrivers || 0),
                0
            );
            return {
                stateCode: state.stateCode,
                name: state.name,
                enabled: state.enabled !== false,
                totalCities: cityRows.length,
                activeCities,
                totalCapacity,
                cities: cityRows
            };
        })
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

    return {
        version: cityActivationConfig.version || 1,
        updatedAt: cityActivationConfig.updatedAt || null,
        updatedBy: cityActivationConfig.updatedBy || null,
        summary: {
            totalStates: states.length,
            enabledStates: states.filter((state) => state.enabled).length,
            totalCities: states.reduce((sum, state) => sum + Number(state.totalCities || 0), 0),
            activeCities: states.reduce((sum, state) => sum + Number(state.activeCities || 0), 0),
            totalCapacity: states.reduce((sum, state) => sum + Number(state.totalCapacity || 0), 0)
        },
        states
    };
}

async function loadCityActivationConfig() {
    const db = getRealtimeDB();

    if (!db) {
        if (!inMemoryCityActivationConfig) {
            inMemoryCityActivationConfig = normalizeConfig(null);
        }
        return { config: deepClone(inMemoryCityActivationConfig), storage: 'memory' };
    }

    const ref = db.ref(CITY_ACTIVATION_DB_PATH);
    const snapshot = await ref.once('value');
    const rawConfig = snapshot.val();
    const normalized = normalizeConfig(rawConfig);

    if (!rawConfig) {
        await ref.set(normalized);
        logStructured('info', 'Config geografia inicializada com base no RJ', {
            service: 'geofence-routes',
            path: CITY_ACTIVATION_DB_PATH
        });
    }

    return { config: normalized, storage: 'firebase' };
}

async function persistCityActivationConfig(configToPersist, storage) {
    if (storage === 'memory') {
        inMemoryCityActivationConfig = deepClone(configToPersist);
        return;
    }

    const db = getRealtimeDB();
    if (!db) {
        throw new Error('Firebase Realtime DB indisponivel');
    }

    await db.ref(CITY_ACTIVATION_DB_PATH).set(configToPersist);
}

async function loadGeofenceAdminConfig() {
    const db = getRealtimeDB();

    if (!db) {
        if (!inMemoryGeofenceAdminConfig) {
            inMemoryGeofenceAdminConfig = applyGeofenceAdminConfig(normalizeGeofenceAdminConfig(null));
        } else {
            inMemoryGeofenceAdminConfig = applyGeofenceAdminConfig(normalizeGeofenceAdminConfig(inMemoryGeofenceAdminConfig));
        }
        return { config: deepClone(inMemoryGeofenceAdminConfig), storage: 'memory' };
    }

    const ref = db.ref(GEOFENCE_ADMIN_DB_PATH);
    const snapshot = await ref.once('value');
    const rawConfig = snapshot.val();
    const normalized = normalizeGeofenceAdminConfig(rawConfig);
    const applied = applyGeofenceAdminConfig(normalized);

    if (!rawConfig) {
        await ref.set(applied);
        logStructured('info', 'Config geofence admin inicializada', {
            service: 'geofence-routes',
            path: GEOFENCE_ADMIN_DB_PATH
        });
    }

    return { config: applied, storage: 'firebase' };
}

async function persistGeofenceAdminConfig(configToPersist, storage) {
    if (storage === 'memory') {
        inMemoryGeofenceAdminConfig = deepClone(configToPersist);
        return;
    }

    const db = getRealtimeDB();
    if (!db) {
        throw new Error('Firebase Realtime DB indisponivel');
    }

    await db.ref(GEOFENCE_ADMIN_DB_PATH).set(configToPersist);
}

function extractAdminId(req) {
    return req?.user?.id || req?.user?.email || 'system';
}

function findStateOrCreate(config, stateCode, createIfMissing = false) {
    const safeStateCode = normalizeStateCode(stateCode);
    if (!safeStateCode) {
        return null;
    }

    if (!config.states[safeStateCode] && createIfMissing) {
        config.states[safeStateCode] = {
            stateCode: safeStateCode,
            name: safeStateCode === 'RJ' ? 'Rio de Janeiro' : safeStateCode,
            enabled: true,
            cities: {}
        };
    }

    return config.states[safeStateCode] || null;
}

async function syncGeofenceConfigToRuntime() {
    try {
        await loadGeofenceAdminConfig();
    } catch (error) {
        logError(error, 'Falha ao sincronizar geofence admin no bootstrap', {
            service: 'geofence-routes'
        });
    }
}

void syncGeofenceConfigToRuntime();

/**
 * GET /api/geofence/check
 * Verifica se uma coordenada está dentro da área de operação
 * Query params: lat, lng
 */
router.get('/check', (req, res) => {
    try {
        const { lat, lng } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({
                success: false,
                message: 'Latitude e Longitude são obrigatórias na query (?lat=X&lng=Y)'
            });
        }

        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        if (isNaN(latitude) || isNaN(longitude)) {
            return res.status(400).json({
                success: false,
                message: 'Latitude e Longitude devem ser números válidos'
            });
        }

        // ✅ Manter consistência com a validação usada no createBooking.
        if (!geofenceService.isActive()) {
            return res.json({
                success: true,
                isAllowed: true,
                reason: 'Geofence desativado (sem região configurada)',
                coordinates: { lat: latitude, lng: longitude }
            });
        }

        const isAllowed = geofenceService.isPointInPolygon(latitude, longitude);

        res.json({
            success: true,
            isAllowed,
            reason: isAllowed ? 'Dentro da área de operação' : 'Fora da área de operação permitida',
            coordinates: { lat: latitude, lng: longitude }
        });
    } catch (error) {
        logError(error, 'Erro ao verificar geofence', { service: 'geofence-routes' });
        res.status(500).json({
            success: false,
            message: 'Erro interno ao validar área de operação'
        });
    }
});

/**
 * GET /api/geofence/cities/active
 * Lista as cidades ativas para consumo do app (sem auth)
 * Query params: state (opcional)
 */
router.get('/cities/active', async (req, res) => {
    try {
        const requestedState = normalizeStateCode(req.query.state);
        const { config } = await loadCityActivationConfig();
        const states = Object.values(config.states || {});

        const cities = states.flatMap((state) => {
            if (requestedState && state.stateCode !== requestedState) return [];
            if (state.enabled === false) return [];
            return Object.values(state.cities || {})
                .filter((city) => city.active)
                .map((city) => ({
                    ...city,
                    stateName: state.name
                }));
        });

        res.json({
            success: true,
            state: requestedState || null,
            cities,
            count: cities.length
        });
    } catch (error) {
        logError(error, 'Erro ao listar cidades ativas', { service: 'geofence-routes' });
        res.status(500).json({
            success: false,
            message: 'Erro interno ao listar cidades ativas'
        });
    }
});

/**
 * GET /api/geofence/admin/config
 * Retorna consolidado de geofence + ativacao de cidades
 */
router.get('/admin/config', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
    try {
        const [{ config: cityActivationConfig, storage }, { config: geofenceAdminConfig, storage: geofenceStorage }] = await Promise.all([
            loadCityActivationConfig(),
            loadGeofenceAdminConfig()
        ]);

        res.json({
            success: true,
            geofence: buildGeofenceResponse(geofenceAdminConfig),
            cityActivation: buildConfigResponse(cityActivationConfig),
            storage,
            geofenceStorage
        });
    } catch (error) {
        logError(error, 'Erro ao carregar configuracao geografica admin', { service: 'geofence-routes' });
        res.status(500).json({
            success: false,
            message: 'Erro interno ao carregar configuracao geografica'
        });
    }
});

/**
 * PATCH /api/geofence/admin/config
 * Atualiza geofence sem reiniciar backend
 * Body: { enabled?: boolean, region?: Array<[lng,lat]> }
 */
router.patch('/admin/config', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
    try {
        const { enabled, region } = req.body || {};
        const hasEnabled = typeof enabled === 'boolean';
        const hasRegion = region !== undefined;

        if (!hasEnabled && !hasRegion) {
            return res.status(400).json({
                success: false,
                message: 'Informe ao menos um campo: enabled ou region'
            });
        }

        const { config, storage } = await loadGeofenceAdminConfig();

        if (hasRegion) {
            const regionUpdated = geofenceService.updateRegion(region);
            if (!regionUpdated) {
                return res.status(400).json({
                    success: false,
                    message: 'Formato de region invalido. Envie array de coordenadas [lng, lat] com ao menos 3 pontos'
                });
            }
            config.region = geofenceService.getCurrentRegion() || [];
        } else {
            config.region = geofenceService.getCurrentRegion() || config.region || [];
        }

        if (hasEnabled) {
            geofenceService.setEnabled(enabled);
            config.enabled = enabled;
        } else {
            config.enabled = geofenceService.isEnabled();
        }

        config.version = Number(config.version || 1);
        config.updatedAt = new Date().toISOString();
        config.updatedBy = extractAdminId(req);

        await persistGeofenceAdminConfig(config, storage);

        return res.json({
            success: true,
            message: 'Configuracao de geofence atualizada',
            geofence: buildGeofenceResponse(config),
            storage
        });
    } catch (error) {
        logError(error, 'Erro ao atualizar configuracao de geofence admin', {
            service: 'geofence-routes'
        });
        return res.status(500).json({
            success: false,
            message: 'Erro interno ao atualizar configuracao de geofence'
        });
    }
});

/**
 * PATCH /api/geofence/admin/states/:stateCode
 * Ativa/desativa estado para operacao
 * Body: { enabled: boolean }
 */
router.patch('/admin/states/:stateCode', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
    try {
        const safeStateCode = normalizeStateCode(req.params.stateCode);
        const { enabled } = req.body || {};

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'Campo "enabled" deve ser booleano'
            });
        }

        const { config, storage } = await loadCityActivationConfig();
        const state = findStateOrCreate(config, safeStateCode, true);
        if (!state) {
            return res.status(400).json({
                success: false,
                message: 'Estado invalido'
            });
        }

        state.enabled = enabled;
        config.updatedAt = new Date().toISOString();
        config.updatedBy = extractAdminId(req);

        await persistCityActivationConfig(config, storage);

        res.json({
            success: true,
            message: `Estado ${safeStateCode} ${enabled ? 'ativado' : 'desativado'} com sucesso`,
            state: {
                stateCode: state.stateCode,
                name: state.name,
                enabled: state.enabled
            },
            cityActivation: buildConfigResponse(config)
        });
    } catch (error) {
        logError(error, 'Erro ao atualizar estado geografico', { service: 'geofence-routes' });
        res.status(500).json({
            success: false,
            message: 'Erro interno ao atualizar estado geografico'
        });
    }
});

/**
 * PATCH /api/geofence/admin/cities/:stateCode/:cityKey
 * Ativa/desativa cidade existente.
 * Body: { active: boolean }
 */
router.patch('/admin/cities/:stateCode/:cityKey', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
    try {
        const safeStateCode = normalizeStateCode(req.params.stateCode);
        const cityKey = slugify(req.params.cityKey);
        const { active, maxActiveDrivers, waitlistEnabled } = req.body || {};

        if (!cityKey) {
            return res.status(400).json({
                success: false,
                message: 'Cidade invalida'
            });
        }

        const hasActive = typeof active === 'boolean';
        const hasCapacity = maxActiveDrivers !== undefined;
        const hasWaitlistEnabled = typeof waitlistEnabled === 'boolean';
        const parsedCapacity = Number(maxActiveDrivers);

        if (!hasActive && !hasCapacity && !hasWaitlistEnabled) {
            return res.status(400).json({
                success: false,
                message: 'Informe pelo menos um campo para atualizar: active, maxActiveDrivers ou waitlistEnabled'
            });
        }

        if (hasCapacity && (!Number.isFinite(parsedCapacity) || parsedCapacity < 0)) {
            return res.status(400).json({
                success: false,
                message: 'Campo "maxActiveDrivers" deve ser numero >= 0'
            });
        }

        const { config, storage } = await loadCityActivationConfig();
        const state = findStateOrCreate(config, safeStateCode, false);

        if (!state) {
            return res.status(404).json({
                success: false,
                message: `Estado ${safeStateCode} nao encontrado`
            });
        }

        const city = state.cities?.[cityKey];
        if (!city) {
            return res.status(404).json({
                success: false,
                message: `Cidade ${cityKey} nao encontrada no estado ${safeStateCode}`
            });
        }

        if (hasActive) {
            city.active = active;
        }
        if (hasCapacity) {
            city.maxActiveDrivers = parsedCapacity;
        }
        if (hasWaitlistEnabled) {
            city.waitlistEnabled = waitlistEnabled;
        }
        city.stateCode = safeStateCode;
        state.cities[cityKey] = city;

        config.updatedAt = new Date().toISOString();
        config.updatedBy = extractAdminId(req);

        await persistCityActivationConfig(config, storage);

        res.json({
            success: true,
            message: `Cidade ${city.label || city.name} atualizada com sucesso`,
            city,
            cityActivation: buildConfigResponse(config)
        });
    } catch (error) {
        logError(error, 'Erro ao atualizar cidade geografica', { service: 'geofence-routes' });
        res.status(500).json({
            success: false,
            message: 'Erro interno ao atualizar cidade geografica'
        });
    }
});

/**
 * POST /api/geofence/admin/cities
 * Cria uma nova cidade no estado informado.
 * Body: { stateCode, name, value?, active? }
 */
router.post('/admin/cities', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
    try {
        const safeStateCode = normalizeStateCode(req.body?.stateCode);
        const cityName = String(req.body?.name || '').trim();
        const active = typeof req.body?.active === 'boolean' ? req.body.active : false;
        const value = slugify(req.body?.value || `${cityName}-${safeStateCode}`);
        const cityKey = slugify(value);

        if (!safeStateCode) {
            return res.status(400).json({
                success: false,
                message: 'stateCode eh obrigatorio'
            });
        }

        if (!cityName || cityName.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'name da cidade eh obrigatorio'
            });
        }

        if (!cityKey) {
            return res.status(400).json({
                success: false,
                message: 'Nao foi possivel gerar chave da cidade'
            });
        }

        const { config, storage } = await loadCityActivationConfig();
        const state = findStateOrCreate(config, safeStateCode, true);
        const currentCities = Object.values(state.cities || {});
        const maxPriority = currentCities.reduce((acc, city) => Math.max(acc, Number(city.priority || 0)), 0);

        const city = normalizeCityRecord(cityKey, {
            name: cityName,
            value,
            label: req.body?.label || `${cityName} - ${safeStateCode}`,
            active,
            priority: maxPriority + 1,
            maxActiveDrivers: Number(req.body?.maxActiveDrivers || DEFAULT_MAX_ACTIVE_DRIVERS_PER_CITY),
            waitlistEnabled: req.body?.waitlistEnabled !== false
        }, safeStateCode);

        state.cities[city.key] = city;
        config.updatedAt = new Date().toISOString();
        config.updatedBy = extractAdminId(req);

        await persistCityActivationConfig(config, storage);

        res.json({
            success: true,
            message: `Cidade ${city.label} salva com sucesso`,
            city,
            cityActivation: buildConfigResponse(config)
        });
    } catch (error) {
        logError(error, 'Erro ao criar cidade geografica', { service: 'geofence-routes' });
        res.status(500).json({
            success: false,
            message: 'Erro interno ao criar cidade geografica'
        });
    }
});

module.exports = router;
