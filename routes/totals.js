// backend/routes/totals.js
const express = require("express");
const router = express.Router();
const db = require("../db"); // your database connection

// GET /api/total-money
router.get("/", (req, res) => {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // Get token price first
    db.query("SELECT setting_value FROM settings WHERE setting_key = 'token_price'", (err0, tokenResult) => {
      let tokenPrice = 500;
      if (!err0 && tokenResult && tokenResult.length > 0) {
        tokenPrice = Number(tokenResult[0].setting_value) || 500;
      }

      // Bar/Drinks total - SUM of (sold * price)
      db.query(
        "SELECT SUM(sold * price) AS total FROM bar_products",
        async (err1, drinksResult) => {
          if (err1) return res.status(500).json(err1);
          const drinks = drinksResult[0]?.total || 0;

          // Kitchen total - SUM of (sold * price)
          db.query(
            "SELECT SUM(sold * price) AS total FROM kitchen_products",
            async (err2, kitchenResult) => {
              if (err2) return res.status(500).json(err2);
              const kitchen = kitchenResult[0]?.total || 0;

              // Billiard total - SUM of ((token * tokenPrice) + cash + cash_momo)
              db.query(
                "SELECT SUM((token * ?) + cash + cash_momo) AS total FROM billiard",
                [tokenPrice],
                async (err3, billiardResult) => {
                  if (err3) return res.status(500).json(err3);
                  const billiard = billiardResult[0]?.total || 0;

                  // Gym total - SUM of (cash + cash_momo)
                  db.query(
                    "SELECT SUM(cash + cash_momo) AS total FROM gym",
                    async (err4, gymResult) => {
                      if (err4) return res.status(500).json(err4);
                      const gym = gymResult[0]?.total || 0;

                      // Guesthouse total - SUM of (vip * vip_price + normal * normal_price)
                      db.query(
                        "SELECT SUM((vip * vip_price) + (normal * normal_price)) AS total FROM guesthouse",
                        async (err5, guesthouseResult) => {
                          if (err5) return res.status(500).json(err5);
                          const guesthouse = guesthouseResult[0]?.total || 0;

                          // Expenses total - SUM of amount
                          db.query(
                            "SELECT SUM(amount) AS total FROM expenses",
                            (err6, expensesResult) => {
                              if (err6) return res.status(500).json(err6);
                              const expenses = expensesResult[0]?.total || 0;

                              // Send JSON response
                              res.json({
                                drinks: Number(drinks) || 0,
                                kitchen: Number(kitchen) || 0,
                                billiard: Number(billiard) || 0,
                                gym: Number(gym) || 0,
                                guesthouse: Number(guesthouse) || 0,
                                expenses: Number(expenses) || 0,
                              });
                            }
                          );
                        }
                      );
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
