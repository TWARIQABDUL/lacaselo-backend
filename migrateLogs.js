const db = require("./db");

async function migrateLogsTable() {
  try {
    console.log("Creating activity_logs table...");
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        log_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        username VARCHAR(255) NOT NULL,
        action TEXT DEFAULT NULL,
        page VARCHAR(100) DEFAULT NULL,
        branch_id INT DEFAULT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        product_name VARCHAR(255) DEFAULT '-',
        action_type VARCHAR(255) DEFAULT '-',
        before_val TEXT DEFAULT NULL,
        after_val TEXT DEFAULT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("Table created successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit();
  }
}

migrateLogsTable();
