const db = require('../db');
async function check() {
  try {
    const [rows] = await db.promise().query("SELECT DISTINCT role FROM users");
    console.log("Distinct Roles:", rows);
    const [cols] = await db.promise().query("DESCRIBE employee_loans");
    console.log("employee_loans columns:", cols);
  } catch (e) {
    console.error(e);
  } finally {
    db.end();
  }
}
check();
