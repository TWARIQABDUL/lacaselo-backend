const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/AuthMiddlewares");
const allowRoles = require("../middleware/roleMiddleware");
const auditLog = require("../utils/auditLogger");

// ==================================================
// GET ALL USERS (Admin Only)
// ==================================================
router.get("/", verifyToken, allowRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT userId, username, role, status, branch_id, created_at FROM users ORDER BY userId DESC"
    );
    res.json(rows);
  } catch (error) {
    console.error("Fetch Users Error:", error);
    res.status(500).json({ message: "Failed to fetch users", error: error.message });
  }
});

// ==================================================
// ADD NEW USER (Admin Only)
// ==================================================
router.post("/", verifyToken, allowRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const { username, password, role, branch_id } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: "Username, password and role are required" });
  }

  try {
    const [result] = await db.promise().query(
      "INSERT INTO users (username, password, role, branch_id, status) VALUES (?, ?, ?, ?, 'active')",
      [username, password, role, branch_id || null]
    );

    await auditLog(req, `Created new user: ${username} with role: ${role}`);

    res.json({
      message: "User created successfully",
      userId: result.insertId
    });
  } catch (error) {
    console.error("Create User Error:", error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: "Username already exists" });
    }
    res.status(500).json({ message: "Failed to create user", error: error.message });
  }
});

// ==================================================
// UPDATE USER (Admin Only)
// ==================================================
router.put("/:id", verifyToken, allowRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const { id } = req.params;
  const { username, role, status, branch_id, password } = req.body;

  try {
    // Build update query dynamically
    let updates = [];
    let values = [];

    if (username) { updates.push("username = ?"); values.push(username); }
    if (role) { updates.push("role = ?"); values.push(role); }
    if (status) { updates.push("status = ?"); values.push(status); }
    if (branch_id !== undefined) { updates.push("branch_id = ?"); values.push(branch_id); }
    if (password) { updates.push("password = ?"); values.push(password); }

    if (updates.length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }
    
    // Fetch old data
    const [oldRows] = await db.promise().query("SELECT * FROM users WHERE userId = ?", [id]);
    const old = oldRows.length > 0 ? oldRows[0] : null;

    values.push(id);
    const sql = `UPDATE users SET ${updates.join(", ")} WHERE userId = ?`;

    await db.promise().query(sql, values);
    
    if (old) {
      let changes = [];
      if (username && old.username !== username) changes.push(`Username: ${old.username} -> ${username}`);
      if (role && old.role !== role) changes.push(`Role: ${old.role} -> ${role}`);
      if (status && old.status !== status) changes.push(`Status: ${old.status} -> ${status}`);
      if (branch_id !== undefined && old.branch_id != branch_id) changes.push(`Branch: ${old.branch_id} -> ${branch_id}`);
      if (password) changes.push(`Password was changed`);
      
      if (changes.length > 0) {
        await auditLog(req, `Edited User ${old.username}: ${changes.join(', ')}`);
      }
    }
    
    res.json({ message: "User updated successfully" });
  } catch (error) {
    console.error("Update User Error:", error);
    res.status(500).json({ message: "Failed to update user", error: error.message });
  }
});

// ==================================================
// DELETE USER (Admin Only)
// ==================================================
router.delete("/:id", verifyToken, allowRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const { id } = req.params;

  try {
    const [oldRows] = await db.promise().query("SELECT username FROM users WHERE userId = ?", [id]);
    const username = oldRows.length > 0 ? oldRows[0].username : "Unknown";

    await db.promise().query("DELETE FROM users WHERE userId = ?", [id]);
    
    await auditLog(req, `Deleted User: ${username}`);
    
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete User Error:", error);
    res.status(500).json({ message: "Failed to delete user", error: error.message });
  }
});

module.exports = router;
