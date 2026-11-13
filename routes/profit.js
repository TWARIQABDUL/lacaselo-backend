const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/AuthMiddlewares");
const allowRoles = require("../middleware/roleMiddleware");

const DEPARTMENTS = ["bar", "kitchen", "billiard", "gym", "guesthouse"];

const num = (v) => Number(v) || 0;

// =====================================================
// ADMIN: MONTHLY PROFIT PER DEPARTMENT
// bar/kitchen profit = sold * (price - initial_price)
// billiard/gym/guesthouse have no cost data: income = profit
// =====================================================
router.get("/month", verifyToken, allowRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const { month } = req.query; // YYYY-MM
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) {
    return res.status(400).json({ message: "Month is required as YYYY-MM" });
  }

  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const pool = db.promise();

  try {
    let tokenPrice = 500;
    const [t] = await pool.query("SELECT setting_value FROM settings WHERE setting_key = 'token_price'");
    if (t.length > 0) tokenPrice = Number(t[0].setting_value) || 500;

    const D = "DATE_FORMAT(date, '%Y-%m-%d')";
    const range = [start, end];

    const [bar] = await pool.query(
      `SELECT ${D} AS d, SUM(sold * price) AS sales, SUM(sold * (price - initial_price)) AS profit
         FROM bar_products WHERE date BETWEEN ? AND ? GROUP BY date`, range);
    const [kitchen] = await pool.query(
      `SELECT ${D} AS d, SUM(sold * price) AS sales, SUM(sold * (price - initial_price)) AS profit
         FROM kitchen_products WHERE date BETWEEN ? AND ? GROUP BY date`, range);
    const [billiard] = await pool.query(
      `SELECT ${D} AS d, SUM((token * ?) + cash + cash_momo) AS sales
         FROM billiard WHERE date BETWEEN ? AND ? GROUP BY date`, [tokenPrice, ...range]);
    const [gym] = await pool.query(
      `SELECT ${D} AS d, SUM(cash + cash_momo) AS sales
         FROM gym WHERE date BETWEEN ? AND ? GROUP BY date`, range);
    const [guesthouse] = await pool.query(
      `SELECT ${D} AS d, SUM((vip * vip_price) + (normal * normal_price)) AS sales
         FROM guesthouse WHERE date BETWEEN ? AND ? GROUP BY date`, range);
    const [expenses] = await pool.query(
      `SELECT ${D} AS d, category, SUM(amount) AS total
         FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date, category`, range);

    const days = {};
    const day = (d) => {
      if (!days[d]) {
        days[d] = { date: d, general_expenses: 0 };
        DEPARTMENTS.forEach((k) => (days[d][k] = { sales: 0, profit: 0, expenses: 0, net: 0 }));
      }
      return days[d];
    };

    bar.forEach((r) => { day(r.d).bar.sales = num(r.sales); day(r.d).bar.profit = num(r.profit); });
    kitchen.forEach((r) => { day(r.d).kitchen.sales = num(r.sales); day(r.d).kitchen.profit = num(r.profit); });
    [["billiard", billiard], ["gym", gym], ["guesthouse", guesthouse]].forEach(([k, rows]) =>
      rows.forEach((r) => { day(r.d)[k].sales = num(r.sales); day(r.d)[k].profit = num(r.sales); })
    );
    expenses.forEach((r) => {
      const dd = day(r.d);
      if (DEPARTMENTS.includes(r.category)) dd[r.category].expenses += num(r.total);
      else dd.general_expenses += num(r.total); // "unprofitable" and anything else
    });

    const departments = {};
    DEPARTMENTS.forEach((k) => (departments[k] = { sales: 0, profit: 0, expenses: 0, net: 0 }));
    const totals = { sales: 0, profit: 0, expenses: 0, general_expenses: 0, net: 0 };

    const list = Object.values(days).sort((a, b) => (a.date < b.date ? -1 : 1));
    list.forEach((dd) => {
      let dayProfit = 0;
      let dayExpenses = dd.general_expenses;
      DEPARTMENTS.forEach((k) => {
        const x = dd[k];
        x.net = x.profit - x.expenses;
        departments[k].sales += x.sales;
        departments[k].profit += x.profit;
        departments[k].expenses += x.expenses;
        dayProfit += x.profit;
        dayExpenses += x.expenses;
      });
      dd.profit = dayProfit;
      dd.expenses = dayExpenses;
      dd.net = dayProfit - dayExpenses;
      totals.general_expenses += dd.general_expenses;
    });
    DEPARTMENTS.forEach((k) => {
      departments[k].net = departments[k].profit - departments[k].expenses;
      totals.sales += departments[k].sales;
      totals.profit += departments[k].profit;
      totals.expenses += departments[k].expenses;
    });
    totals.expenses += totals.general_expenses;
    totals.net = totals.profit - totals.expenses;

    res.json({ month, days: list, departments, totals });
  } catch (err) {
    console.error("Monthly profit error:", err);
    res.status(500).json({ message: "Failed to load monthly profit" });
  }
});

module.exports = router;
