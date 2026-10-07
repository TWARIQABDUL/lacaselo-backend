const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/AuthMiddlewares");
const auditLog = require("../utils/auditLogger");

// =====================================================
// GET ALL COMMENTS OR BY DEPARTMENT FOR A DATE
// =====================================================
router.get("/", verifyToken, (req, res) => {
  const { date, department } = req.query;

  if (!date) {
    return res.status(400).json({ message: "Date is required" });
  }

  let query = "SELECT * FROM closing_comments WHERE date = ?";
  let params = [date];

  if (department) {
    query += " AND department = ?";
    params.push(department);
  }

  db.query(query, params, (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// =====================================================
// ADD OR UPDATE A COMMENT (UPSERT)
// =====================================================
router.post("/", verifyToken, (req, res) => {
  const { date, department, comment } = req.body;
  const user = req.user;

  if (!date || !department || comment === undefined) {
    return res.status(400).json({ message: "Date, department, and comment are required" });
  }

  // Check if a comment already exists for this date and department
  db.query(
    "SELECT id, comment FROM closing_comments WHERE date = ? AND department = ?",
    [date, department],
    (err, rows) => {
      if (err) return res.status(500).json(err);

      if (rows.length > 0) {
        // A saved comment is final for staff; only admins can change it
        if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
          return res.status(409).json({ message: "This comment was already saved and cannot be edited." });
        }

        // Update existing comment
        const oldComment = rows[0].comment;
        db.query(
          "UPDATE closing_comments SET comment = ?, user_id = ?, username = ? WHERE id = ?",
          [comment, user.userId, user.username, rows[0].id],
          (updateErr) => {
            if (updateErr) return res.status(500).json(updateErr);

            auditLog(req, {
              action_type: 'Update Closing Comment',
              product_name: department,
              before_val: oldComment,
              after_val: comment
            });

            return res.json({ message: "Comment updated successfully" });
          }
        );
      } else {
        // Insert new comment
        db.query(
          "INSERT INTO closing_comments (date, department, user_id, username, comment) VALUES (?, ?, ?, ?, ?)",
          [date, department, user.userId, user.username, comment],
          (insertErr, result) => {
            if (insertErr) return res.status(500).json(insertErr);

            auditLog(req, {
              action_type: 'Add Closing Comment',
              product_name: department,
              after_val: comment
            });

            return res.json({ message: "Comment added successfully", id: result.insertId });
          }
        );
      }
    }
  );
});

module.exports = router;
