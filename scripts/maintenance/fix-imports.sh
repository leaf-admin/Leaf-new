#!/bin/bash

echo "Corrigindo imports problemáticos..."

# Corrigir imports de "../types" para "../types.js"
find mobile-app/src/common-local -name "*.js" -type f -exec sed -i 's/from "\.\.\/types"/from "..\/types.js"/g' {} \;

# Corrigir imports de "../types" para "../types.js" (sem aspas duplas)
find mobile-app/src/common-local -name "*.js" -type f -exec sed -i "s/from '\.\.\/types'/from '..\/types.js'/g" {} \;

echo "Imports corrigidos com sucesso!" 