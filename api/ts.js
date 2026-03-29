const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const querystring = require("querystring");

const app = express();

/* ================= USERS (TOKEN SYSTEM) ================= */

const USERS = {
  "Q05WNEVBj0loV45WXGqMcouScXRjdWeLdIGUUl9ub4WEmGJoY5A=": {
    username: "Alisindhi077",
    password: "Alisindhi-077"
  }
};

/* ================= CONFIG ================= */

const BASE_URL = "https://www.timesms.org/ints";

let cookies = {};
let sessions = {};

/* ================= REQUEST ================= */

function request(method, url, data = null, headers = {}, token) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;

    const reqHeaders = {
      "User-Agent": "Mozilla/5.0",
      "Accept-Encoding": "gzip, deflate",
      Cookie: cookies[token] ? cookies[token].join("; ") : "",
      ...headers
    };

    if (method === "POST" && data) {
      reqHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      reqHeaders["Content-Length"] = Buffer.byteLength(data);
    }

    const req = lib.request(url, { method, headers: reqHeaders }, res => {
      if (res.headers["set-cookie"]) {
        cookies[token] = res.headers["set-cookie"].map(c => c.split(";")[0]);
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

/* ================= CAPTCHA ================= */

function solveCaptcha(html) {
  const match = html.match(/What is\s+(\d+)\s*([\+\-\*])\s*(\d+)/i);
  if (!match) return 10;

  const a = Number(match[1]);
  const op = match[2];
  const b = Number(match[3]);

  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;

  return 10;
}

/* ================= LOGIN ================= */

async function login(token) {
  if (sessions[token]) return;

  const user = USERS[token];
  if (!user) throw new Error("Invalid token");

  cookies[token] = [];

  const page = await request("GET", `${BASE_URL}/login`, null, {}, token);

  const ans = solveCaptcha(page);

  const form = querystring.stringify({
    username: user.username,
    password: user.password,
    capt: ans
  });

  await request(
    "POST",
    `${BASE_URL}/signin`,
    form,
    { Referer: `${BASE_URL}/login` },
    token
  );

  sessions[token] = true;
}

/* ================= FETCH SMS (UNLIMITED) ================= */

async function fetchSMS(token) {
  const url =
    `${BASE_URL}/agent/res/data_smscdr.php?` +
    `fdate1=2020-01-01%2000:00:00&fdate2=2099-12-31%2023:59:59` +
    `&iDisplayLength=-1&iSortCol_0=0&sSortDir_0=desc`;

  const data = await request("GET", url, null, {
    Referer: `${BASE_URL}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest"
  }, token);

  return JSON.parse(data);
}

/* ================= FORMAT ================= */

function formatSMS(data) {
  if (!data.aaData) {
    return { status: "error", msg: "No data" };
  }

  const formatted = data.aaData.map(row => ({
    dt: row[0],
    num: row[1],
    cli: row[2],
    message: row[4],
    payout: (row[6] || "").replace(/<[^>]+>/g, "").trim()
  }));

  return {
    status: "success",
    total: formatted.length,
    data: formatted
  };
}

/* ================= API ================= */

app.get("/api/sms", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.json({ status: "error", msg: "Token required" });
  }

  try {
    await login(token);

    const raw = await fetchSMS(token);
    const result = formatSMS(raw);

    res.json(result);
  } catch (err) {
    sessions[token] = false;
    res.json({ status: "error", msg: err.message });
  }
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
