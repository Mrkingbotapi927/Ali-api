const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const querystring = require("querystring");

const app = express();

/* ================= CONFIG ================= */

const CONFIG = {
  baseUrl: "https://ivas.tempnum.qzz.io/ints",
  email: "iamalisindhi1122@gmail.com",
  password: "Shoaibali@123D..king",
  userAgent:
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/144 Mobile"
};

/* ================= SESSION CACHE ================= */

let session = {
  cookies: [],
  lastLogin: 0
};

const SESSION_LIFE = 10 * 60 * 1000; // 10 minutes

function sessionValid() {
  return Date.now() - session.lastLogin < SESSION_LIFE;
}

/* ================= SAFE JSON ================= */

function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Invalid JSON from IVAS" };
  }
}

/* ================= REQUEST ================= */

function request(method, url, data = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;

    const headers = {
      "User-Agent": CONFIG.userAgent,
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate",
      Cookie: session.cookies.join("; "),
      ...extraHeaders
    };

    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
    }

    const req = lib.request(url, { method, headers }, res => {
      if (res.headers["set-cookie"]) {
        session.cookies = res.headers["set-cookie"].map(c =>
          c.split(";")[0]
        );
      }

      let chunks = [];
      res.on("data", d => chunks.push(d));

      res.on("end", () => {
        let buffer = Buffer.concat(chunks);
        try {
          if (res.headers["content-encoding"] === "gzip") {
            buffer = zlib.gunzipSync(buffer);
          }
        } catch {}
        resolve(buffer.toString());
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/* ================= LOGIN ================= */

async function ensureLogin() {
  if (sessionValid()) return;

  session.cookies = [];

  const page = await request("GET", `${CONFIG.baseUrl}/login`);

  const match = page.match(/What is (\d+) \+ (\d+)/i);
  const capt = match ? Number(match[1]) + Number(match[2]) : 10;

  const form = querystring.stringify({
    email: CONFIG.email,
    password: CONFIG.password,
    capt
  });

  await request(
    "POST",
    `${CONFIG.baseUrl}/signin`,
    form,
    { Referer: `${CONFIG.baseUrl}/login` }
  );

  session.lastLogin = Date.now();
}

/* ================= FIX NUMBERS ================= */

function fixNumbers(data) {
  if (!data.aaData) return data;

  data.aaData = data.aaData.map(row => [
    row[1],
    "",
    row[3],
    "Weekly",
    (row[4] || "").replace(/<[^>]+>/g, "").trim(),
    (row[7] || "").replace(/<[^>]+>/g, "").trim()
  ]);

  return data;
}

/* ================= FIX SMS ================= */

function fixSMS(data) {
  if (!data.aaData) return data;

  data.aaData = data.aaData
    .map(row => {
      let message = (row[5] || "")
        .replace(/legendhacker/gi, "")
        .trim();

      if (!message) return null;

      return [
        row[0],
        row[1],
        row[2],
        row[3],
        message,
        "$",
        row[7] || 0
      ];
    })
    .filter(Boolean);

  return data;
}

/* ================= FETCH ================= */

async function getNumbers() {
  await ensureLogin();

  const url =
    `${CONFIG.baseUrl}/agent/res/data_smsnumbers.php?` +
    `frange=&fclient=&sEcho=2&iDisplayStart=0&iDisplayLength=-1`;

  const data = await request("GET", url, null, {
    Referer: `${CONFIG.baseUrl}/agent/MySMSNumbers`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return fixNumbers(safeJSON(data));
}

async function getSMS() {
  await ensureLogin();

  const today = new Date();

  const d = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const url =
    `${CONFIG.baseUrl}/agent/res/data_smscdr.php?` +
    `fdate1=${d}%2000:00:00&fdate2=${d}%2023:59:59` +
    `&frange=&fclient=&fnum=&fcli=&fg=0&iDisplayLength=5000`;

  const data = await request("GET", url, null, {
    Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return fixSMS(safeJSON(data));
}

/* ================= API ================= */

app.get("/api", async (req, res) => {
  const { type } = req.query;

  try {
    if (type === "numbers") return res.json(await getNumbers());
    if (type === "sms") return res.json(await getSMS());

    res.json({ error: "Use ?type=numbers or ?type=sms" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("IVAS API running on " + PORT));