@echo off
echo ========================================
echo VERIFICANDO CONTAINERS DOCKER
echo ========================================
echo.

echo Containers em execucao:
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ========================================
echo TODOS OS CONTAINERS (incluindo parados):
echo ========================================
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ========================================
echo IMAGENS DISPONIVEIS:
echo ========================================
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

echo.
echo ========================================
echo USO DE DISCO DO DOCKER:
echo ========================================
docker system df

echo.
pause 
echo ========================================
echo VERIFICANDO CONTAINERS DOCKER
echo ========================================
echo.

echo Containers em execucao:
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ========================================
echo TODOS OS CONTAINERS (incluindo parados):
echo ========================================
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ========================================
echo IMAGENS DISPONIVEIS:
echo ========================================
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

echo.
echo ========================================
echo USO DE DISCO DO DOCKER:
echo ========================================
docker system df

echo.
pause 
echo ========================================
echo VERIFICANDO CONTAINERS DOCKER
echo ========================================
echo.

echo Containers em execucao:
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ========================================
echo TODOS OS CONTAINERS (incluindo parados):
echo ========================================
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ========================================
echo IMAGENS DISPONIVEIS:
echo ========================================
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

echo.
echo ========================================
echo USO DE DISCO DO DOCKER:
echo ========================================
docker system df

echo.
pause 