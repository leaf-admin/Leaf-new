// test-graphql-simple.js
// Teste simples do GraphQL

const { makeExecutableSchema } = require('@graphql-tools/schema');
const { graphql } = require('graphql');

// Importar schema e resolvers
const { schema } = require('./graphql/schema');
const resolvers = require('./graphql/resolvers');

async function testGraphQL() {
  console.log('🧪 TESTANDO GRAPHQL SIMPLES');
  console.log('============================');
  
  try {
    // Criar schema executável
    const executableSchema = makeExecutableSchema({
      typeDefs: schema,
      resolvers
    });
    
    console.log('✅ Schema executável criado com sucesso!');
    
    // Teste simples de introspection
    const introspectionQuery = `
      query IntrospectionQuery {
        __schema {
          queryType {
            name
            fields {
              name
              description
            }
          }
        }
      }
    `;
    
    const result = await graphql({
      schema: executableSchema,
      source: introspectionQuery
    });
    
    if (result.errors) {
      console.error('❌ Erros na introspection:', result.errors);
      return;
    }
    
    console.log('✅ Introspection funcionando!');
    console.log('📊 Queries disponíveis:', result.data.__schema.queryType.fields.length);
    
    // Listar algumas queries
    const queries = result.data.__schema.queryType.fields.slice(0, 5);
    console.log('🔍 Primeiras 5 queries:');
    queries.forEach(query => {
      console.log(`  - ${query.name}: ${query.description || 'Sem descrição'}`);
    });
    
    console.log('\n🎉 GraphQL está funcionando perfeitamente!');
    
  } catch (error) {
    console.error('❌ Erro ao testar GraphQL:', error);
  }
}

testGraphQL();




