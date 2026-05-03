#!/bin/bash
set -e

echo "=== BTrader Organism Installer (PeerTree) ==="

# ---------------------------------------------------------
# Firewall
# ---------------------------------------------------------
ufw allow 11396/tcp   # PeerTree network
ufw allow 11398/tcp   # Monitor port
# 11397 receptor stays closed unless manually opened

# ---------------------------------------------------------
# Disable NTP (PeerTree uses chrony discipline)
# ---------------------------------------------------------
timedatectl set-ntp false

# ---------------------------------------------------------
# Install Node.js 20
# ---------------------------------------------------------
curl -sL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh
bash nodesource_setup.sh
apt install -y nodejs

# ---------------------------------------------------------
# Directory layout
# ---------------------------------------------------------
mkdir -p /peerTree
mkdir -p /peerTree/keys
mkdir -p /peerTree/ftree
mkdir -p /mnt/db
mkdir -p /mnt/db/dumps

cd /peerTree

# ---------------------------------------------------------
# Download PeerTree core libs
# ---------------------------------------------------------
curl https://admin.bitmonky.com/bitMDis/peerTree.js          -o peerTree.js
curl https://admin.bitmonky.com/bitMDis/peerCrypt.js         -o peerCrypt.js
curl https://admin.bitmonky.com/bitMDis/addslashes.js        -o addslashes.js
curl https://admin.bitmonky.com/bitMDis/mkyDatef.js          -o mkyDatef.js
curl https://admin.bitmonky.com/bitMDis/networkWebConsole.js -o networkWebConsole.js
curl https://admin.bitmonky.com/bitMDis/bitWebMoniter.js     -o bitWebMoniter.js

# ---------------------------------------------------------
# Download BTrader organism files
# ---------------------------------------------------------
curl https://admin.bitmonky.com/bitMDis/btraderOrganObj.js   -o btraderOrganObj.js
curl https://admin.bitmonky.com/bitMDis/btraderOrganCell.js  -o btraderOrganCell.js
curl https://admin.bitmonky.com/bitMDis/pstartBTraderCell.sh -o pstartBTrader.sh

chmod 774 p*.sh

# ---------------------------------------------------------
# TLS Certificate Generation
# ---------------------------------------------------------
mkdir -p keys

openssl genrsa -out keys/private.key 2048
openssl req -new -key keys/private.key -out keys/certificate.csr -subj "/CN=localhost"
openssl x509 -req -days 365 -in keys/certificate.csr -signkey keys/private.key -out keys/certificate.crt
rm keys/certificate.csr

mv keys/private.key keys/privkey.pem
mv keys/certificate.crt keys/fullchain.pem

chmod 644 keys/fullchain.pem
chmod 600 keys/privkey.pem

echo "SSL certificates generated."

# ---------------------------------------------------------
# Node dependencies
# ---------------------------------------------------------
npm install mysql
npm install mysql2
npm install axios
npm install portscanner
npm install bs58
npm install elliptic
npm install dns-sync
npm install bitcoinjs-lib
npm install node-schedule
npm install -g pm2

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
USERID="btraderDBA"
DBNAME="btrader"

echo "{\"user\":\"${USERID}\",\"pass\":\"${PASSWDDB}\"}" > btraderdbconf

mysql -e "DROP DATABASE IF EXISTS ${DBNAME};"
mysql -e "CREATE DATABASE ${DBNAME};"

mysql -e "CREATE USER '${USERID}'@'localhost' IDENTIFIED BY '${PASSWDDB}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DBNAME}.* TO '${USERID}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# ---------------------------------------------------------
# Load schema (buy/sell/fills)
# ---------------------------------------------------------
curl https://admin.bitmonky.com/bitMDis/btraderSchema.sql -o /mnt/db/dumps/btraderSchema.sql
mysql ${DBNAME} < /mnt/db/dumps/btraderSchema.sql

echo "Database initialized."

# ---------------------------------------------------------
# Done
# ---------------------------------------------------------
echo "=== BTrader install complete ==="
echo "DB credentials stored in /peerTree/btraderdbconf"

