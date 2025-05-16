require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkConnection() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
    });

    console.log('✅ Successfully connected to the database.');
    await connection.end();
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
  }
}

checkConnection();
