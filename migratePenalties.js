const db = require('./db');

const testSql = "SHOW CREATE TABLE credits";

db.promise().query(testSql)
  .then(([rows]) => {
    console.log(rows[0]['Create Table']);
    
    const sql = `
    CREATE TABLE IF NOT EXISTS employee_penalties (
      id INT NOT NULL AUTO_INCREMENT,
      employee_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      reason TEXT,
      penalty_date DATE NOT NULL,
      given_by VARCHAR(255) DEFAULT 'unknown',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      is_locked TINYINT DEFAULT '0',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    
    return db.promise().query(sql);
  })
  .then(() => {
    console.log("Migration successful: employee_penalties table created (without FK for now).");
    process.exit(0);
  })
  .catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
