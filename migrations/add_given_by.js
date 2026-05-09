const db = require('../db');

async function migrate() {
  try {
    console.log("Checking if 'given_by' column exists in 'employee_loans'...");
    const [columns] = await db.promise().query("SHOW COLUMNS FROM employee_loans LIKE 'given_by'");
    
    if (columns.length === 0) {
      console.log("Adding 'given_by' column...");
      await db.promise().query("ALTER TABLE employee_loans ADD COLUMN given_by VARCHAR(255) DEFAULT 'unknown'");
      console.log("Column 'given_by' added successfully.");
    } else {
      console.log("Column 'given_by' already exists.");
    }
  } catch (error) {
    console.error("Migration Error:", error);
  } finally {
    db.end();
  }
}

migrate();
