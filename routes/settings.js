const express = require("express");
const router = express.Router();
const db = require("../db");
const auditLog = require("../utils/auditLogger");

// Initialize table
db.query(`CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(50) UNIQUE NOT NULL,
  setting_value VARCHAR(255) NOT NULL
)`, (err) => {
  if (err) console.error("Error creating settings table:", err);
  else {
    db.query(`INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('token_price', '500')`, (err2) => {
      if (err2) console.error("Error inserting default token_price:", err2);
    });
  }
});

// GET all settings or specific setting
router.get("/", (req, res) => {
  const { key } = req.query;
  let sql = "SELECT * FROM settings";
  const params = [];
  if (key) {
    sql += " WHERE setting_key = ?";
    params.push(key);
  }
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    if (key && rows.length > 0) return res.json(rows[0]);
    if (key) return res.status(404).json({ message: "Setting not found" });
    res.json(rows);
  });
});

// UPDATE setting
router.put("/", (req, res) => {
  const { setting_key, setting_value } = req.body;
  if (!setting_key || !setting_value) return res.status(400).json({ message: "Key and value required" });
  
  db.query("SELECT setting_value FROM settings WHERE setting_key = ?", [setting_key], (selErr, selRows) => {
    const oldVal = selRows && selRows.length > 0 ? selRows[0].setting_value : null;

    db.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [setting_key, setting_value, setting_value],
      (err, result) => {
        if (err) return res.status(500).json(err);
        
        if (oldVal !== setting_value) {
          auditLog(req, `Updated Setting ${setting_key}: ${oldVal || 'None'} -> ${setting_value}`);
        }
        
        res.json({ message: "Setting updated", setting_key, setting_value });
      }
    );
  });
});

module.exports = router;
