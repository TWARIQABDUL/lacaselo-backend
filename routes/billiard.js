const express = require("express");
const router = express.Router();
const db = require("../db");
const auditLog = require("../utils/auditLogger");

// Helper to get token price
function getTokenPrice(callback) {
  db.query("SELECT setting_value FROM settings WHERE setting_key = 'token_price'", (err, rows) => {
    let tokenPrice = 500;
    if (!err && rows && rows.length > 0) {
      tokenPrice = Number(rows[0].setting_value) || 500;
    }
    callback(tokenPrice);
  });
}

// ================= GET ALL RECORDS =================
router.get("/", (req, res) => {
  const { date } = req.query;

  getTokenPrice((tokenPrice) => {
    let sql = "SELECT * FROM billiard";
    const params = [];

    if (date) {
      sql += " WHERE date = ?";
      params.push(date);
    }

    sql += " ORDER BY id DESC";

    db.query(sql, params, (err, rows) => {
      if (err) return res.status(500).json(err);

      // Calculate total dynamically using token price
      const dataWithTotal = rows.map((r) => ({
        ...r,
        total: (Number(r.token || 0) * tokenPrice) + Number(r.cash || 0) + Number(r.cash_momo || 0)
      }));

      res.json(dataWithTotal);
    });
  });
});

// ================= ADD RECORD =================
router.post("/", (req, res) => {
  const { date, token, cash, cash_momo } = req.body;

  if (!date) return res.status(400).json({ message: "Date is required" });

  getTokenPrice((tokenPrice) => {
    const sql = "INSERT INTO billiard (date, token, cash, cash_momo) VALUES (?, ?, ?, ?)";

    db.query(
      sql,
      [date, Number(token || 0), Number(cash || 0), Number(cash_momo || 0)],
      (err, result) => {
        if (err) return res.status(500).json(err);
        
        auditLog(req, {
          action_type: 'Add Record',
          product_name: `Date: ${date}`,
          after_val: `Income: ${income}`
        });

        db.query("SELECT * FROM billiard WHERE id = ?", [result.insertId], (err2, rows) => {
          if (err2) return res.status(500).json(err2);

          const row = rows[0];
          row.total = (Number(row.token || 0) * tokenPrice) + Number(row.cash || 0) + Number(row.cash_momo || 0);
          res.json(row);
        });
      }
    );
  });
});

// ================= UPDATE RECORD =================
router.put("/:id", (req, res) => {
  const { token, cash, cash_momo } = req.body;
  const { id } = req.params;

  getTokenPrice((tokenPrice) => {
    const sql = "UPDATE billiard SET token=?, cash=?, cash_momo=? WHERE id=?";

    db.query("SELECT * FROM billiard WHERE id=?", [id], (selErr, selRows) => {
      const old = selRows && selRows.length > 0 ? selRows[0] : null;

      db.query(sql, [Number(token || 0), Number(cash || 0), Number(cash_momo || 0), id], (err) => {
        if (err) return res.status(500).json(err);
        
        if (old) {
          let changes = [];
          if (old.token != token) changes.push(`Token: ${old.token} -> ${token}`);
          if (old.cash != cash) changes.push(`Cash: ${old.cash} -> ${cash}`);
          if (old.cash_momo != cash_momo) changes.push(`MoMo: ${old.cash_momo} -> ${cash_momo}`);
          
          if (changes.length > 0) {
            auditLog(req, {
              action_type: 'Edit Record',
              product_name: `Date: ${old.date}`,
              after_val: changes.join(', ')
            });
          }
        }

        db.query("SELECT * FROM billiard WHERE id = ?", [id], (err2, rows) => {
          if (err2) return res.status(500).json(err2);

          const row = rows[0];
          row.total = (Number(row.token || 0) * tokenPrice) + Number(row.cash || 0) + Number(row.cash_momo || 0);
          res.json(row);
        });
      });
    });
  });
});

// ================= DELETE RECORD =================
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  db.query("SELECT date FROM billiard WHERE id=?", [id], (selErr, selRows) => {
    const date = selRows && selRows.length > 0 ? selRows[0].date : "Unknown";

    db.query("DELETE FROM billiard WHERE id=?", [id], (err) => {
      if (err) return res.status(500).json(err);
      
      auditLog(req, {
        action_type: 'Delete Record',
        product_name: `Date: ${date}`
      });
      res.json({ message: "Billiard record deleted successfully" });
    });
  });
});

// ================= GET STATS - DAY, WEEK, MONTH, YEAR TOTALS =================
router.get("/stats/timePeriods", (req, res) => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartStr = weekStart.toISOString().split("T")[0];
  
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split("T")[0];
  
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const yearStartStr = yearStart.toISOString().split("T")[0];

  getTokenPrice((tokenPrice) => {
    db.query(
      "SELECT SUM((token * ?) + cash + cash_momo) AS total FROM billiard WHERE date = ?",
      [tokenPrice, todayStr],
      (err1, dayResult) => {
        if (err1) return res.status(500).json(err1);
        const dayTotal = dayResult[0]?.total || 0;

        db.query(
          "SELECT SUM((token * ?) + cash + cash_momo) AS total FROM billiard WHERE date >= ? AND date <= ?",
          [tokenPrice, weekStartStr, todayStr],
          (err2, weekResult) => {
            if (err2) return res.status(500).json(err2);
            const weekTotal = weekResult[0]?.total || 0;

            db.query(
              "SELECT SUM((token * ?) + cash + cash_momo) AS total FROM billiard WHERE date >= ? AND date <= ?",
              [tokenPrice, monthStartStr, todayStr],
              (err3, monthResult) => {
                if (err3) return res.status(500).json(err3);
                const monthTotal = monthResult[0]?.total || 0;

                db.query(
                  "SELECT SUM((token * ?) + cash + cash_momo) AS total FROM billiard WHERE date >= ? AND date <= ?",
                  [tokenPrice, yearStartStr, todayStr],
                  (err4, yearResult) => {
                    if (err4) return res.status(500).json(err4);
                    const yearTotal = yearResult[0]?.total || 0;

                    res.json({
                      day: Number(dayTotal) || 0,
                      week: Number(weekTotal) || 0,
                      month: Number(monthTotal) || 0,
                      year: Number(yearTotal) || 0,
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

module.exports = router;