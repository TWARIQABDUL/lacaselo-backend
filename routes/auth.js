const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const auditLog = require("../utils/auditLogger");

router.post("/login", async (req, res) => {
  try {
    console.time("login_total");
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password required",
      });
    }

    const [rows] = await db.promise().query(
      "SELECT * FROM users WHERE username = ? AND status='active'",
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        message: "Invalid username",
      });
    }

    const user = rows[0];

    if (password !== user.password) {
      return res.status(401).json({
        message: "Invalid password",
      });
    }

    const token = jwt.sign(
      {
        id: user.userId,
        username: user.username,
        role: user.role,
        branch: user.branch_id,
      },
      "lacaselo_secret_key",
      { expiresIn: "8h" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.userId,
        username: user.username,
        role: user.role,
        branch: user.branch_id,
      },
    });
    
    // Log the login activity
    // Temporarily attach the token to the request so auditLogger can decode it
    req.headers.authorization = `Bearer ${token}`;
    await auditLog(req, `User logged in: ${user.username}`);
    
    console.timeEnd("login_total");
  } catch (error) {
    console.error("❌ Login Error:", error.message);
    console.error("Stack:", error.stack);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;