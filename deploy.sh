#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Aggiorno codice da GitHub..."
git pull

echo "Ricostruisco e riavvio Docker..."
docker compose --env-file .env.docker up -d --build

echo "Pulizia immagini non usate..."
docker image prune -f

echo "Deploy completato."
echo "Apri: http://localhost:8082"
