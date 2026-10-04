const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/AuthMiddlewares");
const allowRoles = require("../middleware/roleMiddleware");
const auditLog = require("../utils/auditLogger");

const isAdminRole = (role) => role === "SUPER_ADMIN" || role === "ADMIN";

// Self-creating table: new table only, nothing existing is altered.
let tableReady = null;
const ensureTable = () => {
  if (!tableReady) {
    tableReady = db
      .promise()
      .query(
        `CREATE TABLE IF NOT EXISTS closings (
          id INT NOT NULL AUTO_INCREMENT,
          date DATE NOT NULL,
          department VARCHAR(50) NOT NULL,
          user_id INT NOT NULL,
          username VARCHAR(255),
          momo_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          cash_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          system_sales DECIMAL(14,2) NOT NULL DEFAULT 0,
          received_amount DECIMAL(14,2) DEFAULT NULL,
          received_by VARCHAR(255) DEFAULT NULL,
          received_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY closing_date_dept (date, department)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      )
      .catch((err) => {
        tableReady = null; // retry on next request
        throw err;
      });
  }
  return tableReady;
};

const validAmount = (v) => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0;

// =====================================================
// GET CLOSINGS FOR A DATE (optionally one department)
// =====================================================
router.get("/", verifyToken, async (req, res) => {
  const { date, department } = req.query;
  if (!date) return res.status(400).json({ message: "Date is required" });

  try {
    await ensureTable();
    let query = "SELECT * FROM closings WHERE date = ?";
    const params = [date];
    if (department) {
      query += " AND department = ?";
      params.push(department);
    }
    query += " ORDER BY department";

    const [rows] = await db.promise().query(query, params);

    // Staff must not see what admin recorded as received
    if (!isAdminRole(req.user.role)) {
      rows.forEach((r) => {
        delete r.received_amount;
        delete r.received_by;
        delete r.received_at;
      });
    }
    res.json(rows);
  } catch (err) {
    console.error("Get closings error:", err);
    res.status(500).json({ message: "Failed to load closings" });
  }
});

// =====================================================
// SUBMIT A CLOSING (ONE PER DATE+DEPARTMENT, IMMUTABLE)
// =====================================================
router.post("/", verifyToken, async (req, res) => {
  const { date, department, momo_amount, cash_amount, system_sales } = req.body;

  if (!date || !department || !validAmount(momo_amount) || !validAmount(cash_amount)) {
    return res.status(400).json({ message: "Date, department, code amount and cash amount are required" });
  }

  try {
    await ensureTable();
    const [result] = await db.promise().query(
      `INSERT INTO closings (date, department, user_id, username, momo_amount, cash_amount, system_sales)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        date,
        department,
        req.user.userId,
        req.user.username,
        Number(momo_amount),
        Number(cash_amount),
        validAmount(system_sales) ? Number(system_sales) : 0,
      ]
    );

    auditLog(req, {
      action_type: "Submit Closing",
      product_name: department,
      after_val: `date: ${date}, code: ${momo_amount}, cash: ${cash_amount}, sales: ${system_sales}`,
    });

    res.json({ message: "Closing submitted successfully", id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "A closing was already submitted for this date and department" });
    }
    console.error("Submit closing error:", err);
    res.status(500).json({ message: "Failed to submit closing" });
  }
});

// =====================================================
// ADMIN: RECORD AMOUNT RECEIVED
// =====================================================
router.put("/:id/received", verifyToken, allowRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const { received_amount } = req.body;
  if (!validAmount(received_amount)) {
    return res.status(400).json({ message: "A valid received amount is required" });
  }

  try {
    await ensureTable();
    const [rows] = await db.promise().query("SELECT * FROM closings WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: "Closing not found" });

    await db.promise().query(
      "UPDATE closings SET received_amount = ?, received_by = ?, received_at = NOW() WHERE id = ?",
      [Number(received_amount), req.user.username, req.params.id]
    );

    auditLog(req, {
      action_type: "Record Closing Received",
      product_name: rows[0].department,
      before_val: rows[0].received_amount === null ? "-" : String(rows[0].received_amount),
      after_val: String(received_amount),
    });

    res.json({ message: "Received amount saved" });
  } catch (err) {
    console.error("Save received error:", err);
    res.status(500).json({ message: "Failed to save received amount" });
  }
});

module.exports = router;
