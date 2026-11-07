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
// Past dates still open for submitting a closing (locked again once submitted)
const UNLOCKED_DATES = ["2026-10-01", "2026-10-02", "2026-10-03"];

// Stock value for a date: bar + kitchen sold value only
// (billiard, gym and guesthouse are deliberately excluded from the closing check)
const getSystemSales = async (date) => {
  let failed = false;
  const q = async (sql, params) => {
    try {
      const [rows] = await db.promise().query(sql, params);
      return Number(rows[0]?.total) || 0;
    } catch (e) {
      console.error("Closing sales query failed:", e.message);
      failed = true;
      return 0;
    }
  };

  const breakdown = {
    bar: await q("SELECT SUM(sold * price) AS total FROM bar_products WHERE date = ?", [date]),
    kitchen: await q("SELECT SUM(sold * price) AS total FROM kitchen_products WHERE date = ?", [date]),
  };
  const total = breakdown.bar + breakdown.kitchen;
  return { total, breakdown, failed };
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

    // Keep each closing's stock value in line with the current rule (bar + kitchen).
    // If the calculation fails, the stored value is left untouched.
    if (rows.length > 0) {
      const sales = await getSystemSales(date);
      if (!sales.failed) {
        for (const r of rows) {
          if (Number(r.system_sales) !== sales.total) {
            await db.promise().query("UPDATE closings SET system_sales = ? WHERE id = ?", [sales.total, r.id]);
            r.system_sales = sales.total;
          }
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
// ADMIN: FULL MONTH LIST (closings + comments per day)
// =====================================================
router.get("/month", verifyToken, allowRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const { month } = req.query; // YYYY-MM
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) {
    return res.status(400).json({ message: "Month is required as YYYY-MM" });
  }

  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  try {
    await ensureTable();
    const pool = db.promise();

    const [closings] = await pool.query(
      `SELECT id, DATE_FORMAT(date, '%Y-%m-%d') AS date, username, momo_amount, cash_amount,
              system_sales, received_amount, received_by
         FROM closings WHERE department = ? AND date BETWEEN ? AND ? ORDER BY date`,
      [COMBINED, start, end]
    );

    const [comments] = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, department, username, comment, created_at
         FROM closing_comments WHERE date BETWEEN ? AND ? ORDER BY date, department`,
      [start, end]
    );

    // Current bar + kitchen sold value per day (same rule as the closing check)
    const salesByDate = {};
    let salesOk = true;
    for (const table of ["bar_products", "kitchen_products"]) {
      try {
        const [rows] = await pool.query(
          `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, SUM(sold * price) AS total
             FROM ${table} WHERE date BETWEEN ? AND ? GROUP BY date`,
          [start, end]
        );
        rows.forEach((r) => {
          salesByDate[r.d] = (salesByDate[r.d] || 0) + (Number(r.total) || 0);
        });
      } catch (e) {
        console.error("Month sales query failed:", e.message);
        salesOk = false;
      }
    }

    const days = {};
    const day = (d) => (days[d] = days[d] || { date: d, closing: null, comments: [] });

    closings.forEach((c) => {
      const systemSales = salesOk ? salesByDate[c.date] || 0 : Number(c.system_sales) || 0;
      const momo = Number(c.momo_amount) || 0;
      const cash = Number(c.cash_amount) || 0;
      const received = c.received_amount === null ? null : Number(c.received_amount);
      day(c.date).closing = {
        id: c.id,
        username: c.username,
        system_sales: systemSales,
        momo_amount: momo,
        cash_amount: cash,
        received_amount: received,
        received_by: c.received_by,
        sales_gap: systemSales - (momo + cash), // > 0 missing, < 0 extra
        cash_gap: received === null ? null : cash - received, // > 0 missing at admin
      };
    });
    comments.forEach((c) => day(c.date).comments.push(c));

    const list = Object.values(days).sort((a, b) => (a.date < b.date ? -1 : 1));

    const totals = { days_closed: 0, system_sales: 0, momo_amount: 0, cash_amount: 0, received_amount: 0, sales_gap: 0, cash_gap: 0 };
    list.forEach((d) => {
      if (!d.closing) return;
      totals.days_closed += 1;
      totals.system_sales += d.closing.system_sales;
      totals.momo_amount += d.closing.momo_amount;
      totals.cash_amount += d.closing.cash_amount;
      totals.sales_gap += d.closing.sales_gap;
      if (d.closing.received_amount !== null) {
        totals.received_amount += d.closing.received_amount;
        totals.cash_gap += d.closing.cash_gap;
      }
    });

    res.json({ month, days: list, totals });
  } catch (err) {
    console.error("Month closings error:", err);
    res.status(500).json({ message: "Failed to load monthly closings" });
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
    if (sales.failed) return res.status(500).json({ message: "Failed to calculate system sales" });
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

  const todayStr = new Date().toISOString().split("T")[0];
  if (date < todayStr && !UNLOCKED_DATES.includes(date)) {
    return res.status(403).json({ message: "Closings cannot be submitted for past dates." });
  }

  try {
    await ensureTable();
    const sales = await getSystemSales(date);
    if (sales.failed) {
      return res.status(500).json({ message: "Could not calculate the system stock value, please try again" });
    }
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
