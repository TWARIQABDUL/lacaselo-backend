const db = require("./db");

async function migrateLogsTable() {
  try {
    console.log("Creating activity_logs table...");
    await db.promise().query(`
      ALTER TABLE activity_logs 
      ADD COLUMN product_name VARCHAR(255) DEFAULT '-',
      ADD COLUMN action_type VARCHAR(255) DEFAULT '-',
      ADD COLUMN before_val TEXT DEFAULT NULL,
      ADD COLUMN after_val TEXT DEFAULT NULL;
    `);
    console.log("Table created successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit();
  }
}

migrateLogsTable();
