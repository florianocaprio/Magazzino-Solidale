#!/bin/sh
set -e

echo "Attendo PostgreSQL su db:5432..."
until nc -z db 5432; do
  sleep 2
done

echo "PostgreSQL pronto."

echo "Applico gli aggiornamenti DB incrementali..."
pnpm --filter @workspace/db run update

echo "Avvio API..."
exec pnpm --filter @workspace/api-server run start
