const fs = require('fs');
const mysql = require('mysql2');

let dba = null;

// Load DB config
try {
  dba = fs.readFileSync('btraderdbconf');
} catch {
  console.log('database config file `btraderdbconf` NOT Found.');
}

try {
  dba = JSON.parse(dba);
} catch {
  console.log('Error parsing `btraderdbconf` file');
}

let con = createConnection();

function createConnection() {
  const connection = mysql.createConnection({
    host: "127.0.0.1",
    user: dba.user,
    password: dba.pass,
    database: "btrader",
    dateStrings: "date",
    multipleStatements: true,
    supportBigNumbers: true
  });

  connection.connect((err) => {
    if (err) {
      console.error('Error connecting to BTrader database:', err);
      setTimeout(createConnection, 2000); // Retry
    } else {
      console.log('Connected to BTrader database');
    }
  });

  connection.on('error', (err) => {
    console.error('BORG:BTrader MySQL Error:', err);

    if (err.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' ||
        err.code === 'ECONNRESET') {

      console.log('Reconnecting after fatal error...');
      connection.destroy();
      con = createConnection(); // Reconnect
    }
  });

  return connection;
}

module.exports = {
  getConnection: () => con
};

