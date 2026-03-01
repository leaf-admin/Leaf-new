/**
 * Teste das correções de formatAddress e getCategory
 */

const { formatAddress, getCategory } = require('./populate-places-osm');

// Exemplo real do OSM (Barra Mall)
const exampleOSM = {
  tags: {
    "addr:housenumber": "7700",
    "addr:street": "Avenida das Américas",
    "building": "yes",
    "name": "Barra Mall - Bahiense",
    "shop": "mall"
  }
};

// Exemplo sem endereço completo
const exampleOSMIncomplete = {
  tags: {
    "name": "Barra Shopping",
    "building": "yes"
  }
};

console.log('=== TESTE 1: Shopping com endereço completo ===');
console.log('Tags:', JSON.stringify(exampleOSM.tags, null, 2));
console.log('Endereço:', formatAddress(exampleOSM.tags));
console.log('Categoria:', getCategory(exampleOSM.tags));

console.log('\n=== TESTE 2: Shopping sem endereço completo ===');
console.log('Tags:', JSON.stringify(exampleOSMIncomplete.tags, null, 2));
console.log('Endereço:', formatAddress(exampleOSMIncomplete.tags));
console.log('Categoria:', getCategory(exampleOSMIncomplete.tags));

console.log('\n=== TESTE 3: Restaurante ===');
const restaurant = {
  tags: {
    "name": "Restaurante Teste",
    "amenity": "restaurant",
    "addr:street": "Rua Copacabana",
    "addr:housenumber": "123"
  }
};
console.log('Endereço:', formatAddress(restaurant.tags));
console.log('Categoria:', getCategory(restaurant.tags));
































