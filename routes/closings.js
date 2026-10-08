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
      .then(() =>
        db
          .promise()
          .query("ALTER TABLE closings ADD COLUMN system_sales DECIMAL(14,2) NOT NULL DEFAULT 0")
          .catch((e) => {
            if (e.code !== "ER_DUP_FIELDNAME") throw e;
          })
      )
      .catch((err) => {
        tableReady = null; // retry on next request
        throw err;
      });
  }
  return tableReady;
};

// One combined closing per day, submitted by the bar man for all departments
const COMBINED = "all";
const SUBMIT_ROLES = ["BAR_MAN", "MANAGER"];

// Stock value for a date: bar + kitchen sold value only
// (billiard, gym and guesthouse are deliberately excluded from the closing check)
const getSystemSales = async (date) => {
  const q = async (sql, params) => {
    try {
      const [rows] = await db.promise().query(sql, params);
      return Number(rows[0]?.total) || 0;
    } catch (e) {
      console.error("Closing sales query failed:", e.message);
      return 0;
    }
  };

  const breakdown = {
    bar: await q("SELECT SUM(sold * price) AS total FROM bar_products WHERE date = ?", [date]),
    kitchen: await q("SELECT SUM(sold * price) AS total FROM kitchen_products WHERE date = ?", [date]),
  };
  const total = breakdown.bar + breakdown.kitchen;
  return { total, breakdown };
};

const validAmount = (v) => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0;

// =====================================================
// GET THE COMBINED CLOSING FOR A DATE
// =====================================================
router.get("/", verifyToken, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ message: "Date is required" });

  try {
    await ensureTable();
    const [rows] = await db.promise().query("SELECT * FROM closings WHERE date = ? AND department = ?", [date, COMBINED]);

    // Closings saved before sales snapshots existed (or with 0) get their value
    // computed once from the system and stored, so the record is fixed from then on
    for (const r of rows) {
      if (!Number(r.system_sales)) {
        const sales = await getSystemSales(date);
        if (sales.total > 0) {
          await db.promise().query("UPDATE closings SET system_sales = ? WHERE id = ?", [sales.total, r.id]);
          r.system_sales = sales.total;
        }
      }
    }

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
// PREVIEW: SYSTEM SOLD VALUE FOR A DATE (for live checking before submit)
// =====================================================
router.get("/preview", verifyToken, allowRoles(...SUBMIT_ROLES, "SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ message: "Date is required" });
  try {
    const sales = await getSystemSales(date);
    res.json({ system_sales: sales.total });
  } catch (err) {
    console.error("Closing preview error:", err);
    res.status(500).json({ message: "Failed to calculate system sales" });
  }
});

// =====================================================
// SUBMIT THE DAY'S COMBINED CLOSING (ONE PER DATE, IMMUTABLE)
// =====================================================
router.post("/", verifyToken, allowRoles(...SUBMIT_ROLES), async (req, res) => {
  const { date, momo_amount, cash_amount } = req.body;

  if (!date || !validAmount(momo_amount) || !validAmount(cash_amount)) {
    return res.status(400).json({ message: "Date, code amount and cash amount are required" });
  }

  try {
    await ensureTable();
    const sales = await getSystemSales(date);
    const [result] = await db.promise().query(
      `INSERT INTO closings (date, department, user_id, username, momo_amount, cash_amount, system_sales)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [date, COMBINED, req.user.userId, req.user.username, Number(momo_amount), Number(cash_amount), sales.total]
    );

    auditLog(req, {
      action_type: "Submit Closing",
      product_name: "all departments",
      after_val: `date: ${date}, sales: ${sales.total}, code: ${momo_amount}, cash: ${cash_amount}`,
    });

    res.json({ message: "Closing submitted successfully", id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "A closing was already submitted for this date" });
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
