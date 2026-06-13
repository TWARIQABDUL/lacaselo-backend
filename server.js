const express = require("express");
const cors = require("cors");

// ================= ROUTES =================
const barRoutes = require("./routes/bar");
const kitchenRoutes = require("./routes/kitchen");
const expensesRoutes = require("./routes/expenses");
const creditsRoutes = require("./routes/credit"); 
const totalsRoutes = require("./routes/totals");
const billiardRoutes = require("./routes/billiard");
const guesthouseRoutes = require("./routes/guesthouse");
const gymRoutes = require("./routes/gym");
const authRoutes = require("./routes/auth");
const logRoutes = require("./routes/log");
const usersRoutes = require("./routes/users");
const settingsRoutes = require("./routes/settings");

const app = express();

// ================= MIDDLEWARE =================
// CORS: Allow deployed frontend + localhost for development
const FRONTEND_URLS = [
  "https://lacaselo-frontend-1.onrender.com",
  "https://lacaselo-frontend-1-0crh.onrender.com",
  "http://localhost:3000",
  "http://localhost:5000"
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || FRONTEND_URLS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true 
}));

app.use(express.json());

// ================= ROUTES =================
app.use("/api/bar", barRoutes);
app.use("/api/kitchen", kitchenRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/credits", creditsRoutes); 
app.use("/api/billiard", billiardRoutes);
app.use("/api/guesthouse", guesthouseRoutes);
app.use("/api/gym", gymRoutes);
app.use("/api/total-money", totalsRoutes);
app.use("/api", authRoutes);
app.use("/api", logRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/settings", settingsRoutes);

// ================= DEFAULT ROUTE =================
app.get("/", (req, res) => {
  res.send("🚀 Backend is running!");
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});