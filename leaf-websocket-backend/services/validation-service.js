/**
 * Validation Service
 * 
 * Serviço centralizado para validação e sanitização de dados de entrada
 * Focado em escalabilidade, performance e segurança
 * 
 * @module services/validation-service
 */

class ValidationService {
  constructor() {
    // Padrões de validação reutilizáveis
    this.patterns = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      phone: /^\+?[1-9]\d{1,14}$/, // E.164 format
      uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      alphanumeric: /^[a-zA-Z0-9]+$/,
      alphanumericWithSpaces: /^[a-zA-Z0-9\s]+$/,
      numeric: /^\d+$/,
      decimal: /^\d+(\.\d+)?$/
    };
    
    // Limites padrão
    this.limits = {
      string: {
        min: 1,
        max: 10000
      },
      number: {
        min: -Number.MAX_SAFE_INTEGER,
        max: Number.MAX_SAFE_INTEGER
      },
      coordinates: {
        lat: { min: -90, max: 90 },
        lng: { min: -180, max: 180 }
      },
      fare: {
        min: 0,
        max: 10000 // R$ 10.000,00
      },
      distance: {
        min: 0,
        max: 1000000 // 1.000.000 km (impossível, mas seguro)
      }
    };
  }
  
  /**
   * Validar tipo de dado
   * @param {*} value - Valor a ser validado
   * @param {string} type - Tipo esperado (string, number, boolean, object, array)
   * @param {string} fieldName - Nome do campo (para mensagens de erro)
   * @returns {{valid: boolean, error?: string}}
   */
  validateType(value, type, fieldName = 'campo') {
    if (value === null || value === undefined) {
      return { valid: false, error: `${fieldName} é obrigatório` };
    }
    
    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          return { valid: false, error: `${fieldName} deve ser uma string` };
        }
        break;
        
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          return { valid: false, error: `${fieldName} deve ser um número` };
        }
        break;
        
      case 'boolean':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `${fieldName} deve ser um booleano` };
        }
        break;
        
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value) || value === null) {
          return { valid: false, error: `${fieldName} deve ser um objeto` };
        }
        break;
        
      case 'array':
        if (!Array.isArray(value)) {
          return { valid: false, error: `${fieldName} deve ser um array` };
        }
        break;
        
      default:
        return { valid: false, error: `Tipo de validação desconhecido: ${type}` };
    }
    
    return { valid: true };
  }
  
  /**
   * Validar string com limites
   * @param {string} value - Valor a ser validado
   * @param {Object} options - Opções de validação
   * @param {number} options.min - Comprimento mínimo
   * @param {number} options.max - Comprimento máximo
   * @param {string} options.pattern - Nome do padrão regex
   * @param {RegExp} options.customPattern - Padrão regex customizado
   * @param {string} fieldName - Nome do campo
   * @returns {{valid: boolean, error?: string}}
   */
  validateString(value, options = {}, fieldName = 'campo') {
    const typeCheck = this.validateType(value, 'string', fieldName);
    if (!typeCheck.valid) {
      return typeCheck;
    }
    
    const { min = this.limits.string.min, max = this.limits.string.max, pattern, customPattern } = options;
    
    // Validar comprimento
    if (value.length < min) {
      return { valid: false, error: `${fieldName} deve ter no mínimo ${min} caracteres` };
    }
    
    if (value.length > max) {
      return { valid: false, error: `${fieldName} deve ter no máximo ${max} caracteres` };
    }
    
    // Validar padrão
    if (pattern && this.patterns[pattern]) {
      if (!this.patterns[pattern].test(value)) {
        return { valid: false, error: `${fieldName} tem formato inválido` };
      }
    }
    
    if (customPattern) {
      if (!customPattern.test(value)) {
        return { valid: false, error: `${fieldName} tem formato inválido` };
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Validar número com limites
   * @param {number} value - Valor a ser validado
   * @param {Object} options - Opções de validação
   * @param {number} options.min - Valor mínimo
   * @param {number} options.max - Valor máximo
   * @param {boolean} options.integer - Se deve ser inteiro
   * @param {string} fieldName - Nome do campo
   * @returns {{valid: boolean, error?: string}}
   */
  validateNumber(value, options = {}, fieldName = 'campo') {
    const typeCheck = this.validateType(value, 'number', fieldName);
    if (!typeCheck.valid) {
      return typeCheck;
    }
    
    const { min = this.limits.number.min, max = this.limits.number.max, integer = false } = options;
    
    // Validar se é inteiro
    if (integer && !Number.isInteger(value)) {
      return { valid: false, error: `${fieldName} deve ser um número inteiro` };
    }
    
    // Validar limites
    if (value < min) {
      return { valid: false, error: `${fieldName} deve ser no mínimo ${min}` };
    }
    
    if (value > max) {
      return { valid: false, error: `${fieldName} deve ser no máximo ${max}` };
    }
    
    return { valid: true };
  }
  
  /**
   * Validar coordenadas geográficas
   * @param {Object} location - Objeto com lat e lng
   * @param {string} fieldName - Nome do campo
   * @returns {{valid: boolean, error?: string}}
   */
  validateCoordinates(location, fieldName = 'localização') {
    if (!location) {
      return { valid: false, error: `${fieldName} é obrigatório` };
    }
    
    const objectCheck = this.validateType(location, 'object', fieldName);
    if (!objectCheck.valid) {
      return objectCheck;
    }
    
    // Validar lat
    if (location.lat === undefined || location.lat === null) {
      return { valid: false, error: `${fieldName}.lat é obrigatório` };
    }
    
    const latCheck = this.validateNumber(location.lat, {
      min: this.limits.coordinates.lat.min,
      max: this.limits.coordinates.lat.max
    }, `${fieldName}.lat`);
    
    if (!latCheck.valid) {
      return latCheck;
    }
    
    // Validar lng
    if (location.lng === undefined || location.lng === null) {
      return { valid: false, error: `${fieldName}.lng é obrigatório` };
    }
    
    const lngCheck = this.validateNumber(location.lng, {
      min: this.limits.coordinates.lng.min,
      max: this.limits.coordinates.lng.max
    }, `${fieldName}.lng`);
    
    if (!lngCheck.valid) {
      return lngCheck;
    }
    
    return { valid: true };
  }
  
  /**
   * Sanitizar string (prevenir XSS e injection)
   * @param {string} value - String a ser sanitizada
   * @param {Object} options - Opções de sanitização
   * @param {boolean} options.trim - Remover espaços no início/fim
   * @param {boolean} options.removeHtml - Remover tags HTML
   * @param {boolean} options.escapeHtml - Escapar caracteres HTML
   * @returns {string} String sanitizada
   */
  sanitizeString(value, options = {}) {
    if (typeof value !== 'string') {
      return value;
    }
    
    const { trim = true, removeHtml = true, escapeHtml = true } = options;
    
    let sanitized = value;
    
    // Trim
    if (trim) {
      sanitized = sanitized.trim();
    }
    
    // Remover tags HTML
    if (removeHtml) {
      sanitized = sanitized.replace(/<[^>]*>/g, '');
    }
    
    // Escapar caracteres HTML
    if (escapeHtml) {
      const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
      };
      
      sanitized = sanitized.replace(/[&<>"'/]/g, (match) => htmlEscapes[match]);
    }
    
    return sanitized;
  }
  
  /**
   * Validar objeto completo usando schema
   * @param {Object} data - Dados a serem validados
   * @param {Object} schema - Schema de validação
   * @returns {{valid: boolean, errors?: Array, sanitized?: Object}}
   */
  validateSchema(data, schema) {
    const errors = [];
    const sanitized = {};
    
    // Validar campos obrigatórios
    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];
      const isRequired = rules.required !== false; // Default: required
      
      // Verificar se campo obrigatório está presente
      if (isRequired && (value === undefined || value === null)) {
        errors.push({
          field,
          error: `${rules.label || field} é obrigatório`
        });
        continue;
      }
      
      // Se campo não é obrigatório e não está presente, pular
      if (!isRequired && (value === undefined || value === null)) {
        continue;
      }
      
      // Validar coordenadas (tipo especial, não precisa validar tipo primeiro)
      if (rules.type === 'coordinates') {
        const coordCheck = this.validateCoordinates(value, rules.label || field);
        if (!coordCheck.valid) {
          errors.push({ field, error: coordCheck.error });
          continue;
        }
        
        // Sanitizar coordenadas (garantir que são números válidos)
        sanitized[field] = {
          lat: parseFloat(value.lat),
          lng: parseFloat(value.lng)
        };
        continue;
      }
      
      // Validar tipo (para outros tipos)
      if (rules.type && rules.type !== 'coordinates') {
        const typeCheck = this.validateType(value, rules.type, rules.label || field);
        if (!typeCheck.valid) {
          errors.push({ field, error: typeCheck.error });
          continue;
        }
      }
      
      // Validar string
      if (rules.type === 'string') {
        const stringCheck = this.validateString(value, rules, rules.label || field);
        if (!stringCheck.valid) {
          errors.push({ field, error: stringCheck.error });
          continue;
        }
        
        // Sanitizar string
        sanitized[field] = this.sanitizeString(value, rules.sanitize || {});
      }
      // Validar número
      else if (rules.type === 'number') {
        const numberCheck = this.validateNumber(value, rules, rules.label || field);
        if (!numberCheck.valid) {
          errors.push({ field, error: numberCheck.error });
          continue;
        }
        
        sanitized[field] = value;
      }
      // Validar objeto
      else if (rules.type === 'object' && rules.schema) {
        const nestedCheck = this.validateSchema(value, rules.schema);
        if (!nestedCheck.valid) {
          errors.push(...nestedCheck.errors.map(e => ({
            field: `${field}.${e.field}`,
            error: e.error
          })));
          continue;
        }
        
        sanitized[field] = nestedCheck.sanitized;
      }
      // Validar array
      else if (rules.type === 'array') {
        if (!Array.isArray(value)) {
          errors.push({ field, error: `${rules.label || field} deve ser um array` });
          continue;
        }
        
        // Validar cada item do array
        const sanitizedArray = [];
        for (let i = 0; i < value.length; i++) {
          if (rules.itemSchema) {
            const itemCheck = this.validateSchema(value[i], rules.itemSchema);
            if (!itemCheck.valid) {
              errors.push(...itemCheck.errors.map(e => ({
                field: `${field}[${i}].${e.field}`,
                error: e.error
              })));
              continue;
            }
            sanitizedArray.push(itemCheck.sanitized);
          } else {
            sanitizedArray.push(value[i]);
          }
        }
        
        sanitized[field] = sanitizedArray;
      }
      // Outros tipos (boolean, etc)
      else {
        sanitized[field] = value;
      }
    }
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    return { valid: true, sanitized };
  }
  
  /**
   * Schemas de validação para cada endpoint
   */
  getSchemas() {
    return {
      createBooking: {
        customerId: {
          type: 'string',
          required: true,
          min: 1,
          max: 200,
          label: 'ID do cliente'
        },
        pickupLocation: {
          type: 'coordinates',
          required: true,
          label: 'Localização de origem'
        },
        destinationLocation: {
          type: 'coordinates',
          required: true,
          label: 'Localização de destino'
        },
        estimatedFare: {
          type: 'number',
          required: false,
          min: this.limits.fare.min,
          max: this.limits.fare.max,
          label: 'Valor estimado'
        },
        paymentMethod: {
          type: 'string',
          required: false,
          min: 1,
          max: 50,
          pattern: 'alphanumeric',
          label: 'Método de pagamento',
          sanitize: { trim: true, removeHtml: true, escapeHtml: true }
        }
      },
      
      confirmPayment: {
        bookingId: {
          type: 'string',
          required: true,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        },
        paymentMethod: {
          type: 'string',
          required: true,
          min: 1,
          max: 50,
          pattern: 'alphanumeric',
          label: 'Método de pagamento',
          sanitize: { trim: true, removeHtml: true, escapeHtml: true }
        },
        paymentId: {
          type: 'string',
          required: false,
          min: 1,
          max: 200,
          label: 'ID do pagamento'
        },
        amount: {
          type: 'number',
          required: true,
          min: this.limits.fare.min,
          max: this.limits.fare.max,
          label: 'Valor do pagamento'
        }
      },
      
      acceptRide: {
        rideId: {
          type: 'string',
          required: false,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        },
        bookingId: {
          type: 'string',
          required: false,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        }
      },
      
      startTrip: {
        bookingId: {
          type: 'string',
          required: true,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        },
        startLocation: {
          type: 'coordinates',
          required: true,
          label: 'Localização de início'
        }
      },
      
      finishTrip: {
        bookingId: {
          type: 'string',
          required: true,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        },
        endLocation: {
          type: 'coordinates',
          required: true,
          label: 'Localização de fim'
        },
        distance: {
          type: 'number',
          required: false,
          min: this.limits.distance.min,
          max: this.limits.distance.max,
          label: 'Distância'
        },
        fare: {
          type: 'number',
          required: false,
          min: this.limits.fare.min,
          max: this.limits.fare.max,
          label: 'Valor da corrida'
        }
      },
      
      cancelRide: {
        bookingId: {
          type: 'string',
          required: true,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        },
        reason: {
          type: 'string',
          required: false,
          min: 1,
          max: 500,
          label: 'Motivo do cancelamento',
          sanitize: { trim: true, removeHtml: true, escapeHtml: true }
        },
        cancellationFee: {
          type: 'number',
          required: false,
          min: 0,
          max: this.limits.fare.max,
          label: 'Taxa de cancelamento'
        }
      },
      
      rejectRide: {
        bookingId: {
          type: 'string',
          required: true,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        },
        reason: {
          type: 'string',
          required: false,
          min: 1,
          max: 500,
          label: 'Motivo da rejeição',
          sanitize: { trim: true, removeHtml: true, escapeHtml: true }
        }
      },
      
      sendMessage: {
        bookingId: {
          type: 'string',
          required: false,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        },
        rideId: {
          type: 'string',
          required: false,
          min: 1,
          max: 200,
          label: 'ID da corrida'
        },
        message: {
          type: 'string',
          required: true,
          min: 1,
          max: 1000,
          label: 'Mensagem',
          sanitize: { trim: true, removeHtml: true, escapeHtml: true }
        },
        senderId: {
          type: 'string',
          required: true,
          min: 1,
          max: 200,
          label: 'ID do remetente'
        },
        receiverId: {
          type: 'string',
          required: false,
          min: 1,
          max: 200,
          label: 'ID do destinatário'
        }
      }
    };
  }
  
  /**
   * Validar dados de um endpoint específico
   * @param {string} endpoint - Nome do endpoint
   * @param {Object} data - Dados a serem validados
   * @returns {{valid: boolean, errors?: Array, sanitized?: Object}}
   */
  validateEndpoint(endpoint, data) {
    const schemas = this.getSchemas();
    const schema = schemas[endpoint];
    
    if (!schema) {
      return {
        valid: false,
        errors: [{ field: 'endpoint', error: `Schema de validação não encontrado para endpoint: ${endpoint}` }]
      };
    }
    
    return this.validateSchema(data, schema);
  }
}

module.exports = new ValidationService();

