#!/bin/bash
set -e

echo "=== BorgFarmer DB instaler ==="

# ---------------------------------------------------------
# Firewall
# ---------------------------------------------------------

# ---------------------------------------------------------
# Disable NTP (PeerTree uses chrony discipline)
# ---------------------------------------------------------

# ---------------------------------------------------------
# Install Node.js 20
# ---------------------------------------------------------
# ---------------------------------------------------------
# Directory layout
# ---------------------------------------------------------
cd /PeerTree

# ---------------------------------------------------------
# Download PeerTree core libs
# ---------------------------------------------------------

# ---------------------------------------------------------
# Download BTrader organism files
# ---------------------------------------------------------

# ---------------------------------------------------------
# TLS Certificate Generation
# ---------------------------------------------------------
# ---------------------------------------------------------
# Node dependencies
# ---------------------------------------------------------

# ---------------------------------------------------------
# Install MariaDB if needed
# ---------------------------------------------------------
is_installed() {
    dpkg -l | grep -qw "$1"
}

if is_installed "mysql-server" || is_installed "mariadb-server"; then
    echo "MySQL/MariaDB already installed."
else
    echo "Installing MariaDB..."
    apt-get update
    apt-get install -y mariadb-server
fi

# ---------------------------------------------------------
# Create DB + user
# ---------------------------------------------------------
PASSWDDB="$(openssl rand -hex 18)"
USERID="shellFarmerDBA"
DBNAME="shellFarmer"

echo "{\"user\":\"${USERID}\",\"pass\":\"${PASSWDDB}\"}" > shellfarmerdbconf

mysql -e "DROP DATABASE IF EXISTS ${DBNAME};"
mysql -e "CREATE DATABASE ${DBNAME};"

mysql -e "DROP USER IF EXISTS '${USERID}'@'localhost';"
mysql -e "CREATE USER '${USERID}'@'localhost' IDENTIFIED BY '${PASSWDDB}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DBNAME}.* TO '${USERID}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# ---------------------------------------------------------
# Load schema (buy/sell/fills)
# ---------------------------------------------------------
mysql ${DBNAME} < /PeerTree/mariadb/shellFarmer.sql

echo "Database initialized."

# ---------------------------------------------------------
# Done
# ---------------------------------------------------------
echo "=== ShellFarmerDB  install complete ==="
echo "DB credentials stored in /PeerTree/shellfarmerdbconf"
