#!/usr/bin/env bash
# Runs the SFarmAccountant suite against a throwaway MariaDB carrying the real
# shellFarmer + accounting schema.  Leaves report/report.txt behind.
set -uo pipefail
cd "$(dirname "$0")"

mkdir -p sql report

# The DB is initialised from the schema the node actually ships.
cp ../selfrepair/sql/01-schema.sql sql/01-schema.sql
cp ../../mariadb/shellAccounting.sql sql/02-accounting.sql

docker compose down -v --remove-orphans >/dev/null 2>&1

docker compose build suite || exit 1
docker compose run --rm suite
status=$?

docker compose down -v --remove-orphans >/dev/null 2>&1
exit $status
