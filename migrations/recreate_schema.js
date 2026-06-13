const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function recreateSchema() {
  console.log("🚀 Starting database schema recreation...");
  
  // Read the schema file
  const schemaPath = path.join(__dirname, '../schema_only.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error("❌ Schema file not found:", schemaPath);
    console.error("Please run the backup command first to generate schema_only.sql");
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  try {
    // Create a specific connection with multipleStatements: true
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
      multipleStatements: true // Crucial for executing SQL dumps
    });

    console.log(`✅ Connected to database: ${process.env.DB_NAME}`);
    console.log("⏳ Executing schema script... This will DROP existing tables and recreate them.");

    // Execute the schema dump
    await connection.query(sql);

    console.log("✨ Schema recreated successfully!");
    
    await connection.end();
  } catch (error) {
    console.error("❌ Error recreating schema:", error.message);
  }
}

recreateSchema();
