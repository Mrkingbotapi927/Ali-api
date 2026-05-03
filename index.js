const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// --- IMPORT ALL PANELS ---
const roxy = require("./api/roxy");
const roxy1 = require("./api/roxy1");
const np = require("./api/np");
const goat = require("./api/goat");
const ivs = require("./api/ivs");
const ts = require("./api/ts");
const ch = require("./api/ch");
const gen = require("./api/gen");
const mat = require("./api/mat");
const msi = require("./api/msi"); // <-- NEW

// --- ROUTES ---
app.use("/api/roxy", roxy);
app.use("/api/roxy1", roxy1);
app.use("/api/np", np);
app.use("/api/goat", goat);
app.use("/api/ivs", ivs);
app.use("/api/ts", ts);
app.use("/api/ch", ch);
app.use("/api/gen", gen);
app.use("/api/mat", mat);
app.use("/api/msi", msi); // <-- NEW

// --- HEALTH CHECK ---
app.get("/", (req,res)=> res.send("API RUNNING ✅"));

// --- START SERVER ---
app.listen(PORT, "0.0.0.0", ()=>console.log(`🚀 Server running on port ${PORT}`));
