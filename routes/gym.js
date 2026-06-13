const express = require("express");
const router = express.Router();
const db = require("../db");
const auditLog = require("../utils/auditLogger");

// ================= GET ALL GYM RECORDS (FILTER BY DATE) =================
router.get("/", (req, res) => {
  const { date } = req.query;
  let sql = "SELECT * FROM gym";
  const params = [];

  if (date) {
    sql += " WHERE date = ?";
    params.push(date);
  }

  sql += " ORDER BY date DESC";

  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json({ records: rows });
  });
});

// ================= ADD GYM RECORD =================
router.post("/", (req, res) => {
  let { date, daily_people, monthly_people, cash, cash_momo } = req.body;

  if (!date) return res.status(400).json({ message: "Date is required" });

  daily_people = Number(daily_people || 0);
  monthly_people = Number(monthly_people || 0);
  cash = Number(cash || 0);
  cash_momo = Number(cash_momo || 0);
  const total_people = daily_people + monthly_people;

  const sql = `
    INSERT INTO gym
    (date, daily_people, monthly_people, total_people, cash, cash_momo)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  db.query(sql, [date, daily_people, monthly_people, total_people, cash, cash_momo], (err, result) => {
    if (err) return res.status(500).json(err);
    
    auditLog(req, `Added new Gym record for date: ${date}`);
    res.json({ message: "Gym record added", id: result.insertId });
  });
});

// ================= UPDATE GYM RECORD =================
router.put("/:id", (req, res) => {
  const { id } = req.params;
  let { daily_people, monthly_people, cash, cash_momo } = req.body;

  daily_people = Number(daily_people || 0);
  monthly_people = Number(monthly_people || 0);
  cash = Number(cash || 0);
  cash_momo = Number(cash_momo || 0);
  const total_people = daily_people + monthly_people;

  const sql = `
    UPDATE gym
    SET daily_people=?, monthly_people=?, total_people=?, cash=?, cash_momo=?
    WHERE id=?
  `;
  
  db.query("SELECT * FROM gym WHERE id=?", [id], (selErr, selRows) => {
    const old = selRows && selRows.length > 0 ? selRows[0] : null;

    db.query(sql, [daily_people, monthly_people, total_people, cash, cash_momo, id], (err) => {
      if (err) return res.status(500).json(err);
      
      if (old) {
        let changes = [];
        if (old.daily_people != daily_people) changes.push(`Daily People: ${old.daily_people} -> ${daily_people}`);
        if (old.monthly_people != monthly_people) changes.push(`Monthly People: ${old.monthly_people} -> ${monthly_people}`);
        if (old.cash != cash) changes.push(`Cash: ${old.cash} -> ${cash}`);
        if (old.cash_momo != cash_momo) changes.push(`MoMo: ${old.cash_momo} -> ${cash_momo}`);
        
        if (changes.length > 0) {
          auditLog(req, `Edited Gym record for ${old.date}: ${changes.join(', ')}`);
        }
      }
      res.json({ message: "Gym record updated successfully" });
    });
  });
});

const verifyToken = require("../middleware/AuthMiddlewares");
const allowRoles = require("../middleware/roleMiddleware");
const logActivity = require("../utils/activityLogger");

// ================= DELETE GYM RECORD =================
router.delete("/:id", verifyToken, allowRoles("SUPER_ADMIN", "ADMIN"), (req, res) => {
  const { id } = req.params;
  
  db.query("SELECT date FROM gym WHERE id=?", [id], (selErr, selRows) => {
    const date = selRows && selRows.length > 0 ? selRows[0].date : "Unknown";

    const sql = "DELETE FROM gym WHERE id=?";
    db.query(sql, [id], (err) => {
      if (err) return res.status(500).json(err);
      
      auditLog(req, `Deleted Gym record for date: ${date}`);

      res.json({ message: "Gym record deleted successfully" });
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
    "SELECT SUM(cash + cash_momo) AS total FROM gym WHERE date = ?",
    [todayStr],
    (err1, dayResult) => {
      if (err1) return res.status(500).json(err1);
      const dayTotal = dayResult[0]?.total || 0;

      db.query(
        "SELECT SUM(cash + cash_momo) AS total FROM gym WHERE date >= ? AND date <= ?",
        [weekStartStr, todayStr],
        (err2, weekResult) => {
          if (err2) return res.status(500).json(err2);
          const weekTotal = weekResult[0]?.total || 0;

          db.query(
            "SELECT SUM(cash + cash_momo) AS total FROM gym WHERE date >= ? AND date <= ?",
            [monthStartStr, todayStr],
            (err3, monthResult) => {
              if (err3) return res.status(500).json(err3);
              const monthTotal = monthResult[0]?.total || 0;

              db.query(
                "SELECT SUM(cash + cash_momo) AS total FROM gym WHERE date >= ? AND date <= ?",
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