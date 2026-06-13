const express = require("express");
const router = express.Router();
const db = require("../db");

const verifyToken = require("../middleware/AuthMiddlewares");
const allowRoles = require("../middleware/roleMiddleware"); 

router.get(
  "/logs",
  verifyToken,
  allowRoles("SUPER_ADMIN","ADMIN"),
  async (req, res) => {
    try {
      const { date, search } = req.query;
      let sql = "SELECT * FROM activity_logs WHERE 1=1";
      const params = [];

      if (date) {
        sql += " AND DATE(created_at) = ?";
        params.push(date);
      }

      if (search) {
        sql += " AND (action LIKE ? OR username LIKE ? OR page LIKE ?)";
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      sql += " ORDER BY created_at DESC LIMIT 500";

      const [logs] = await db.promise().query(sql, params);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  }
);

module.exports = router;