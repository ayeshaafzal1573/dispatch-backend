const mysql = require('mysql2/promise');
require('dotenv').config();

// Creating the cloud pool
const cloudPool = mysql.createPool({
  host: process.env.CLOUD_DB_HOST,
  user: process.env.CLOUD_DB_USER,
  password: process.env.CLOUD_DB_PASS,
  database: process.env.CLOUD_DB_NAME,
  port: process.env.CLOUD_DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Creating the local pool
const localPool = mysql.createPool({
  host: process.env.LOCAL_DB_HOST,
  user: process.env.LOCAL_DB_USER,
  password: process.env.LOCAL_DB_PASS,
  database: process.env.LOCAL_DB_NAME,
  port: process.env.LOCAL_DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Export getDBPool function that returns the appropriate pool
module.exports = {
  getDBPool: (useCloud = false) => useCloud ? cloudPool : localPool
};
