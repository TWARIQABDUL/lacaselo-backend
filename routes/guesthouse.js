const express = require("express");
const router = express.Router();
const db = require("../db");
const auditLog = require("../utils/auditLogger");

// ================= GET BY DATE =================
router.get("/", (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ message: "Date is required" });
  }

  const sql = "SELECT * FROM guesthouse WHERE date = ? ORDER BY id DESC";

  db.query(sql, [date], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json(err);
    }

    res.json({ rooms: rows });
  });
});

// ================= INSERT =================
router.post("/", (req, res) => {
  const { date, vip, normal, vip_price, normal_price } = req.body;

  if (!date) {
    return res.status(400).json({ message: "Ntamakuru ahari y' izi tariki" });
  }

  const sql = `
    INSERT INTO guesthouse 
    (date, vip, normal, vip_price, normal_price)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      date,
      vip || 0,
      normal || 0,
      vip_price || 0,
      normal_price || 0
    ],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json(err);
      }

      auditLog(req, {
        action_type: 'Add Record',
        product_name: `Date: ${date}`,
        after_val: `Income: ${income}`
      });

      res.json({
        message: "Guesthouse record added",
        id: result.insertId,
      });
    }
  );
});

// ================= UPDATE =================
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const fields = req.body;

  const sql = "UPDATE guesthouse SET ? WHERE id = ?";

  db.query("SELECT * FROM guesthouse WHERE id = ?", [id], (selErr, selRows) => {
    const old = selRows && selRows.length > 0 ? selRows[0] : null;

    db.query(sql, [fields, id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json(err);
      }
      
      if (old) {
        let changes = [];
        if (fields.vip !== undefined && old.vip != fields.vip) changes.push(`VIP: ${old.vip} -> ${fields.vip}`);
        if (fields.normal !== undefined && old.normal != fields.normal) changes.push(`Normal: ${old.normal} -> ${fields.normal}`);
        if (fields.vip_price !== undefined && old.vip_price != fields.vip_price) changes.push(`VIP Price: ${old.vip_price} -> ${fields.vip_price}`);
        if (fields.normal_price !== undefined && old.normal_price != fields.normal_price) changes.push(`Normal Price: ${old.normal_price} -> ${fields.normal_price}`);
        
        if (changes.length > 0) {
          auditLog(req, {
            action_type: 'Edit Record',
            product_name: `Date: ${old.date}`,
            after_val: changes.join(', ')
          });
        }
      }

      res.json({ message: "Updated successfully" });
    });
  });
});

// ================= DELETE =================
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM guesthouse WHERE id = ?";

  db.query("SELECT date FROM guesthouse WHERE id = ?", [id], (selErr, selRows) => {
    const date = selRows && selRows.length > 0 ? selRows[0].date : "Unknown";

    db.query(sql, [id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json(err);
      }
      
      auditLog(req, {
        action_type: 'Delete Record',
        product_name: `Date: ${date}`
      });

      res.json({ message: "Deleted successfully" });
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

  db.query(
    "SELECT SUM((vip * vip_price) + (normal * normal_price)) AS total FROM guesthouse WHERE date = ?",
    [todayStr],
    (err1, dayResult) => {
      if (err1) return res.status(500).json(err1);
      const dayTotal = dayResult[0]?.total || 0;

      db.query(
        "SELECT SUM((vip * vip_price) + (normal * normal_price)) AS total FROM guesthouse WHERE date >= ? AND date <= ?",
        [weekStartStr, todayStr],
        (err2, weekResult) => {
          if (err2) return res.status(500).json(err2);
          const weekTotal = weekResult[0]?.total || 0;

          db.query(
            "SELECT SUM((vip * vip_price) + (normal * normal_price)) AS total FROM guesthouse WHERE date >= ? AND date <= ?",
            [monthStartStr, todayStr],
            (err3, monthResult) => {
              if (err3) return res.status(500).json(err3);
              const monthTotal = monthResult[0]?.total || 0;

              db.query(
                "SELECT SUM((vip * vip_price) + (normal * normal_price)) AS total FROM guesthouse WHERE date >= ? AND date <= ?",
                [yearStartStr, todayStr],
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

module.exports = router;