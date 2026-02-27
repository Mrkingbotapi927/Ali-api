const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// --- IMPORT ALL PANELS ---
const roxy = require("./api/roxy");
const msi = require("./api/msi");
const np = require("./api/np");
const goat = require("./api/goat"); // <-- NEW

// --- ROUTES ---
app.use("/api/roxy", roxy);
app.use("/api/msi", msi);
app.use("/api/np", np);
app.use("/api/goat", goat); // <-- NEW

// --- HEALTH CHECK ---
app.get("/", (req,res)=> res.send("API RUNNING ✅"));

// --- START SERVER ---
app.listen(PORT, "0.0.0.0", ()=>console.log(`🚀 Server running on port ${PORT}`));
