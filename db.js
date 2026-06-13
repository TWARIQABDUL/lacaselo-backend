const fs = require("fs");
const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10
});

// Test connection
db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ MySQL Error:", err.message);
  } else {
    console.log("✅ MySQL Connected to Aiven Cloud!");
    connection.release();
  }
});

module.exports = db;


