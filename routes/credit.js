const express = require("express");
const router = express.Router();
const db = require("../db"); // your MySQL connection
const verifyToken = require("../middleware/AuthMiddlewares");
const allowRoles = require("../middleware/roleMiddleware");
const auditLog = require("../utils/auditLogger");

// ===== GET ALL EMPLOYEES W/ LOANS =====
router.get("/", (req, res) => {
  const sql = `
    SELECT 
      c.id, 
      c.name, 
      c.payment, 
      c.created_at,
      IFNULL(SUM(l.amount), 0) AS total_loan,
      IFNULL(SUM(l.remaining), 0) AS total_remaining
    FROM credits c
    LEFT JOIN employee_loans l ON c.id = l.employee_id
    GROUP BY c.id
    ORDER BY c.id DESC
  `;
  db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch employees" });
    res.json(rows);
  });
});

// ===== ADD NEW EMPLOYEE =====
router.post("/", (req, res) => {
  const { name, payment } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
  if (payment === undefined || isNaN(Number(payment))) return res.status(400).json({ error: "Payment must be a valid number" });

  const sql = "INSERT INTO credits (name, payment) VALUES (?, ?)";
  db.query(sql, [name.trim(), Number(payment)], (err, result) => {
    if (err) {
      console.error("INSERT EMPLOYEE ERROR:", err);
      return res.status(500).json({ error: "Failed to add employee" });
    }

    // Return the newly inserted employee
    db.query("SELECT * FROM credits WHERE id=?", [result.insertId], (err2, rows) => {
      if (err2) return res.status(500).json({ error: "Failed to fetch new employee" });
      
      auditLog(req, {
        action_type: 'Add Employee',
        product_name: name,
        after_val: `Base Payment: ${payment}`
      });
      res.json(rows[0]);
    });
  });
});

// ===== DELETE EXISTING EMPLOYEE =====
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  
  db.query("SELECT name FROM credits WHERE id=?", [id], (selErr, selRows) => {
    const name = selRows && selRows.length > 0 ? selRows[0].name : "Unknown";

    db.query("DELETE FROM credits WHERE id=?", [id], (err) => {
      if (err) return res.status(500).json({ error: "Failed to delete employee" });
      
      auditLog(req, {
        action_type: 'Delete Employee',
        product_name: name
      });
      res.json({ message: "Employee deleted successfully" });
    });
  });
});

// ===== GET EMPLOYEE LOANS =====
router.get("/:id/loans", (req, res) => {
  const { id } = req.params;
  const sql = "SELECT * FROM employee_loans WHERE employee_id=? ORDER BY id DESC";
  db.query(sql, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch loans" });
    res.json(rows);
  });
});

// ===== ADD EMPLOYEE LOAN (Restricted Roles) =====
router.post("/:id/loans", verifyToken, allowRoles("BAR_MAN", "CHIEF_KITCHEN", "SUPER_ADMIN"), (req, res) => {
  const { id } = req.params;
  const { amount, reason, loan_date } = req.body;

  if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: "Valid amount is required" });

  const numAmount = Number(amount);
  const givenBy = req.user?.username || req.body.given_by || "unknown";
  const sql = "INSERT INTO employee_loans (employee_id, amount, reason, loan_date, total_paid, remaining, given_by) VALUES (?, ?, ?, ?, ?, ?, ?)";
  
  db.query(sql, [id, numAmount, reason || "", loan_date, 0, numAmount, givenBy], (err, result) => {
    if (err) {
      console.error("LOAN INSERT ERROR:", err);
      return res.status(500).json({ error: "Failed to add loan", details: err.message });
    }

    db.query("SELECT * FROM employee_loans WHERE id=?", [result.insertId], (err2, rows) => {
      if (err2) return res.status(500).json({ error: "Failed to fetch new loan" });
      
      // Also get employee name for the log
      db.query("SELECT name FROM credits WHERE id=?", [id], (err3, empRows) => {
        const empName = empRows && empRows.length > 0 ? empRows[0].name : "Unknown";
        auditLog(req, {
          action_type: 'Add Loan',
          product_name: empName,
          after_val: `Amount: ${numAmount}`
        });
        res.json(rows[0]);
      });
    });
  });
});

// ===== DELETE EMPLOYEE LOAN =====
router.delete("/:id/loans/:loanId", (req, res) => {
  const { id, loanId } = req.params;
  
  db.query("SELECT amount FROM employee_loans WHERE id=?", [loanId], (selErr, selRows) => {
    const amount = selRows && selRows.length > 0 ? selRows[0].amount : 0;
    
    db.query("SELECT name FROM credits WHERE id=?", [id], (err3, empRows) => {
      const empName = empRows && empRows.length > 0 ? empRows[0].name : "Unknown";
      
      db.query("DELETE FROM employee_loans WHERE id=?", [loanId], (err) => {
        if (err) return res.status(500).json({ error: "Failed to delete loan" });
        
        auditLog(req, {
          action_type: 'Delete Loan',
          product_name: empName,
          before_val: `Amount: ${amount}`
        });
        res.json({ message: "Loan deleted successfully" });
      });
    });
  });
});

// ===== PAY EMPLOYEE LOAN =====
router.put("/:id/loans/:loanId/pay", (req, res) => {
  const { loanId } = req.params;
  const { paymentAmount } = req.body;

  if (!paymentAmount || isNaN(Number(paymentAmount))) {
    return res.status(400).json({ error: "Valid payment amount is required" });
  }

  const amount = Number(paymentAmount);

  // First fetch the current loan to compute the new remaining balance
  db.query("SELECT * FROM employee_loans WHERE id=?", [loanId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch loan" });
    if (rows.length === 0) return res.status(404).json({ error: "Loan not found" });

    const loan = rows[0];
    const newTotalPaid = Number(loan.total_paid || 0) + amount;
    const newRemaining = Number(loan.remaining || 0) - amount;

    // Reject overpayment natively
    if (newRemaining < 0) {
      return res.status(400).json({ error: "Payment exceeds remaining balance" });
    }

    db.query(
      "UPDATE employee_loans SET total_paid=?, remaining=? WHERE id=?",
      [newTotalPaid, newRemaining, loanId],
      (err2) => {
        if (err2) return res.status(500).json({ error: "Failed to update loan" });

        // Return updated loan
        db.query("SELECT * FROM employee_loans WHERE id=?", [loanId], (err3, updatedRows) => {
          if (err3) return res.status(500).json({ error: "Failed to fetch updated loan" });
          
          db.query("SELECT name FROM credits WHERE id=?", [id], (err4, empRows) => {
            const empName = empRows && empRows.length > 0 ? empRows[0].name : "Unknown";
            auditLog(req, {
              action_type: 'Pay Loan',
              product_name: empName,
              before_val: `Paid: ${amount}`,
              after_val: `Remaining: ${newRemaining}`
            });
            res.json(updatedRows[0]);
          });
        });
      }
    );
  });
});

module.exports = router;