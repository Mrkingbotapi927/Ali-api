const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const querystring = require("querystring");

const router = express.Router();

/* ================= CONFIG ================= */

const CONFIG = {
  baseUrl: "http://www.timesms.org/ints", // change if needed
  username: "Alisindhi077",
  password: "Alisindhi-077",
  userAgent:
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Safari/537.36"
};

let cookies = [];
let isLoggedIn = false;

/* ================= SAFE JSON ================= */

function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Invalid JSON from server", raw: text };
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
      Cookie: cookies.join("; "),
      ...extraHeaders
    };

    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
    }

    const req = lib.request(url, { method, headers }, res => {
      if (res.headers["set-cookie"]) {
        cookies = res.headers["set-cookie"].map(c => c.split(";")[0]);
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

/* ================= CAPTCHA SOLVER ================= */

function solveCaptcha(html) {
  const match = html.match(/What is\s+(\d+)\s*([\+\-\*])\s*(\d+)/i);

  if (!match) return 10;

  const a = Number(match[1]);
  const op = match[2];
  const b = Number(match[3]);

  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    default:
      return 10;
  }
}

/* ================= LOGIN ================= */

async function login() {
  if (isLoggedIn) return;

  cookies = [];

  const page = await request("GET", `${CONFIG.baseUrl}/login`);

  const ans = solveCaptcha(page);

  const form = querystring.stringify({
    username: CONFIG.username,
    password: CONFIG.password,
    capt: ans
  });

  await request(
    "POST",
    `${CONFIG.baseUrl}/signin`,
    form,
    { Referer: `${CONFIG.baseUrl}/login` }
  );

  isLoggedIn = true;
}

/* ================= FIX DATA ================= */

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

function fixSMS(data) {
  if (!data.aaData) return data;

  data.aaData = data.aaData.map(row => {
    if (row[4] === null && row[5]) {
      row[4] = row[5];
      row.splice(5, 1);
    }
    return row;
  });

  return data;
}

/* ================= FETCH ================= */

async function getNumbers() {
  const url =
    `${CONFIG.baseUrl}/agent/res/data_smsnumbers.php?` +
    `frange=&fclient=&sEcho=1&iDisplayStart=0&iDisplayLength=-1`;

  const data = await request("GET", url, null, {
    Referer: `${CONFIG.baseUrl}/agent/MySMSNumbers`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return fixNumbers(safeJSON(data));
}

async function getSMS() {
  const url =
    `${CONFIG.baseUrl}/agent/res/data_smscdr.php?` +
    `fdate1=2020-01-01%2000:00:00&fdate2=2099-12-31%2023:59:59` +
    `&iDisplayLength=2000&iSortCol_0=0&sSortDir_0=desc`;

  const data = await request("GET", url, null, {
    Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return fixSMS(safeJSON(data));
}

/* ================= ROUTE ================= */

router.get("/", async (req, res) => {
  const type = req.query.type;

  if (!type) {
    return res.json({
      usage: "/?type=numbers OR /?type=sms"
    });
  }

  try {
    await login();

    let result;

    if (type === "numbers") result = await getNumbers();
    else if (type === "sms") result = await getSMS();
    else return res.json({ error: "Invalid type" });

    res.json(result);
  } catch (err) {
    isLoggedIn = false;
    res.json({ error: err.message });
  }
});

module.exports = router;