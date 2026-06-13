const jwt = require("jsonwebtoken");
const db = require("../db");

const auditLog = async (req, actionDescription) => {
  try {
    const authHeader = req.headers.authorization;
    let userId = 0;
    let username = "System";
    let branchId = null;

    if (authHeader) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          // Decode the token to identify the user making the request
          const decoded = jwt.verify(token, "lacaselo_secret_key");
          userId = decoded.id || 0;
          username = decoded.username || "Unknown";
          branchId = decoded.branch || null;
        } catch (e) {
          // Invalid or expired token; proceed with defaults
        }
      }
    }

    const ipAddress = req.ip || req.connection?.remoteAddress || "unknown";
    
    // Extract the page from the URL (e.g. /api/kitchen/edit/1 -> kitchen)
    let page = "System";
    if (req.originalUrl) {
        const parts = req.originalUrl.split('/');
        if (parts.length > 2) {
            page = parts[2];
        }
    }

    await db.promise().query(
      `INSERT INTO activity_logs (user_id, username, action, page, branch_id, ip_address) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, username, actionDescription, page, branchId, ipAddress]
    );
  } catch (error) {
    console.error("Audit Log Error:", error);
  }
};

module.exports = auditLog;
