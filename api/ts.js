require("dotenv").config();
const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const querystring = require("querystring");

const app = express();
app.use(express.json());

/* ================= CONFIG ================= */
const CONFIG = {
  baseUrl: "https://timesms.net/ints",
  username: "Alisindhi077",
  password: "Alisindhi-077",
  userAgent:
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/144 Mobile"
};

/* ================= SAFE JSON ================= */
function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Invalid JSON from server" };
  }
}

/* ================= COOKIE SAFE REQUEST ================= */
function createRequester() {
  let cookies = [];

  return (method, url, data = null, extraHeaders = {}) =>
    new Promise((resolve, reject) => {
      const lib = url.startsWith("https") ? https : http;

      const headers = {
        "User-Agent": CONFIG.userAgent,
        Accept: "*/*",
        "Accept-Encoding": "gzip, deflate",
        Cookie: cookies.join("; "),
        ...extraHeaders
      };

      if (method === "POST" && data) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers["Content-Length"] = Buffer.byteLength(data);
      }

      const req = lib.request(url, { method, headers }, res => {
        if (res.headers["set-cookie"]) {
          res.headers["set-cookie"].forEach(c => {
            cookies.push(c.split(";")[0]);
          });
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
async function login(request) {
  const page = await request("GET", `${CONFIG.baseUrl}/login`);

  const match = page.match(/What is (\d+) \+ (\d+)/i);
  const capt = match ? Number(match[1]) + Number(match[2]) : 10;

  const form = querystring.stringify({
    username: CONFIG.username,
    password: CONFIG.password,
    capt
  });

  await request(
    "POST",
    `${CONFIG.baseUrl}/signin`,
    form,
    { Referer: `${CONFIG.baseUrl}/login` }
  );
}

/* ================= OTP EXTRACT ================= */
function extractOTP(text) {
  const match = text.match(/\b\d{4,8}\b/);
  return match ? match[0] : null;
}

/* ================= API: GET OTP ================= */
app.get("/api/otp", async (req, res) => {
  try {
    const request = createRequester();
    await login(request);

    const today = new Date();
    const d = `${today.getFullYear()}-${String(
      today.getMonth() + 1
    ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const url =
      `${CONFIG.baseUrl}/agent/res/data_smscdr.php?` +
      `fdate1=${d}%2000:00:00&fdate2=${d}%2023:59:59` +
      `&frange=&fclient=&fnum=&fcli=&fg=0&iDisplayLength=100`;

    const raw = await request("GET", url, null, {
      Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
      "X-Requested-With": "XMLHttpRequest"
    });

    const data = safeJSON(raw);
    const latest = data?.aaData?.[0];
    const message = latest?.[5] || "";
    const otp = extractOTP(message);

    res.json({
      success: true,
      otp,
      message
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});

module.exports = router;
