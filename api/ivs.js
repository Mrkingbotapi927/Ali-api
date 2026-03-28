const express = require("express");
const https   = require("https");
const zlib    = require("zlib");

const router = express.Router();

const BASE_URL  = "https://www.ivasms.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";

let COOKIES = {
  "XSRF-TOKEN":       "eyJpdiI6InpldHRyNDR5Z2RpMzRvUkRCc2ZUclE9PSIsInZhbHVlIjoiRDI4S1lQSW0zZEdSSHQ5RWdPNktnT0RDd2dBM0srTUNSK09TNk9Hazg3bFQ1SEd1citBNHhLb1A3M3JDcDRTZWlYV3ZFMzlOd0FEMitZckFscHZZREVwRkJwa2lVVXg3OXZMSDNRcEZlU05uUk9Fd0hsbHVDRlFpRmVCd08yankiLCJtYWMiOiI5YWQyZGRlYmZkNTJkZTQ0NjBlZDQ1MWUxNDExODJmMjViZmZlZDEwM2JiZDE0Yzg4ZTQ4MTk3NzIyYzAzYzczIiwidGFnIjoiIn0%3D",
  "ivas_sms_session": "eyJpdiI6IjRXa0NVMEtETHNUR2luN1Q3S2xYTGc9PSIsInZhbHVlIjoiVW90aThEcU16TmcrTkoxN0pEU1VTaHRhWW1ZQUptbG1qd0p2SXgyVlgveWJHVjcwNC92U0JnZ1JhZTVpMkhmV2h5c1pDVXBubC9BNUpEeEN4cGM3b0NUalBKZkpDOFNhUnEzNmFyVXlkbmpGYXpoNVUxZmlzWFZ4a2JCN2RIMDQiLCJtYWMiOiJiNDIyMjA4ZTVjZTUwY2QxOTA2NGRkNjhjNmMyMGRhNDZkODE1YzEzY2Q2ODhhMDliYjI5ODllNzE3ZWE2MDBjIiwidGFnIjoiIn0%3D"
};

let cachedToken = null;
let tokenExpiry = 0;

/* ── HELPERS ── */
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function cookieString() {
  return Object.entries(COOKIES).map(([k,v]) => `${k}=${v}`).join("; ");
}
function getXsrf() {
  try { return decodeURIComponent(COOKIES["XSRF-TOKEN"] || ""); }
  catch { return COOKIES["XSRF-TOKEN"] || ""; }
}
function safeJSON(text) {
  try { return JSON.parse(text); }
  catch { return { error: "Invalid JSON", preview: text.substring(0, 300) }; }
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_,r) => setTimeout(() => r(new Error(`Timeout ${ms}ms`)), ms))]);
}
// Extract unique matches from html using multiple patterns
function extractAll(html, ...patterns) {
  const results = [];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) results.push(m[1]);
  }
  return [...new Set(results)];
}

/* ── BATCH PARALLEL (500 numbers, 50 at a time) ── */
async function batchParallel(items, fn, batchSize = 50) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn));
    batchResults.forEach(r => {
      if (r.status === "fulfilled") results.push(...(Array.isArray(r.value) ? r.value : [r.value]));
    });
  }
  return results;
}

/* ── HTTP REQUEST ── */
function makeRequest(method, path, body, contentType, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent":       USER_AGENT,
      "Accept":           "*/*",
      "Accept-Encoding":  "gzip, deflate, br",
      "Accept-Language":  "en-PK,en;q=0.9",
      "Cookie":           cookieString(),
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN":     getXsrf(),
      "X-CSRF-TOKEN":     getXsrf(),
      "Origin":           BASE_URL,
      "Referer":          `${BASE_URL}/portal`,
      ...extraHeaders
    };
    if (method === "POST" && body) {
      headers["Content-Type"]   = contentType;
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = https.request(BASE_URL + path, { method, headers }, res => {
      if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach(c => {
          const sc = c.split(";")[0];
          const ki = sc.indexOf("=");
          if (ki > -1) {
            const k = sc.substring(0, ki).trim();
            const v = sc.substring(ki+1).trim();
            if (k === "XSRF-TOKEN" || k === "ivas_sms_session") COOKIES[k] = v;
          }
        });
      }
      let chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        let buf = Buffer.concat(chunks);
        try {
          const enc = res.headers["content-encoding"];
          if (enc === "gzip") buf = zlib.gunzipSync(buf);
          else if (enc === "br") buf = zlib.brotliDecompressSync(buf);
        } catch {}
        const text = buf.toString("utf-8");
        if (res.statusCode === 401 || res.statusCode === 419 || text.includes('"message":"Unauthenticated"'))
          return reject(new Error("SESSION_EXPIRED"));
        resolve({ status: res.statusCode, body: text });
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error("Timeout 10s")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ── TOKEN (cached 5 min) ── */
async function fetchToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const resp = await makeRequest("GET", "/portal", null, null, { "Accept": "text/html,*/*" });
  const m = resp.body.match(/name="_token"\s+value="([^"]+)"/) ||
            resp.body.match(/"csrf-token"\s+content="([^"]+)"/);
  cachedToken = m ? m[1] : null;
  tokenExpiry = Date.now() + 5 * 60 * 1000;
  return cachedToken;
}

/* ── PARSE SMS MESSAGES ── */
function parseSMSMessages(html, range, number, date) {
  const rows = [];
  const decode = t => (t || "")
    .replace(/&lt;[^&]*&gt;/g, "").replace(/&lt;/g,"").replace(/&gt;/g,"")
    .replace(/&amp;/g,"&").replace(/&#039;/g,"'").replace(/&quot;/g,'"')
    .replace(/<[^>]+>/g,"").replace(/[\r\n]+/g," ").replace(/\s+/g," ").trim();

  const senders = [...html.matchAll(/class="cli-tag"[^>]*>([^<]+)<\/span>/g)].map(m => m[1].trim());
  const msgs    = [...html.matchAll(/class="msg-text"[^>]*>([\s\S]*?)<\/div>/g)].map(m => decode(m[1]));
  const times   = [...html.matchAll(/class="time-cell"[^>]*>\s*(\d{2}:\d{2}:\d{2})\s*</g)].map(m => m[1]);

  msgs.forEach((msg, i) => {
    if (!msg) return;
    rows.push([`${date} ${times[i] || "00:00:00"}`, range, number, senders[i] || "SMS", msg, "$", 0]);
  });
  return rows;
}

/* ── GET SMS (fully parallel, 500 numbers in ~2s) ── */
async function getSMS(token) {
  const today    = getToday();
  const boundary = "----WebKitFormBoundary6I2Js7TBhcJuwIqw";
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="from"\r\n\r\n${today}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="to"\r\n\r\n${today}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="_token"\r\n\r\n${token}`,
    `--${boundary}--`
  ].join("\r\n");

  // Step 1: Get ranges
  const r1 = await makeRequest("POST", "/portal/sms/received/getsms", parts,
    `multipart/form-data; boundary=${boundary}`,
    { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
  );

  const ranges = extractAll(r1.body,
    /toggleRange\(\'([^\']+)\'/g,
    /toggleRange\("([^"]+)"/g,
    /data-range="([^"]+)"/g
  );

  if (ranges.length === 0) {
    return { sEcho:1, iTotalRecords:"0", iTotalDisplayRecords:"0", aaData:[], debug: r1.body.substring(0,300) };
  }

  // Step 2: ALL ranges parallel — get numbers list for each
  const rangeNumberPairs = (await Promise.allSettled(
    ranges.map(async range => {
      const b2 = new URLSearchParams({ _token: token, start: today, end: today, range }).toString();
      try {
        const r2 = await withTimeout(makeRequest("POST", "/portal/sms/received/getsms/number", b2,
          "application/x-www-form-urlencoded",
          { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
        ), 8000);
        const numbers = extractAll(r2.body,
          /toggleNum\w*\('([^']+)'/g,
          /toggleNum\w*\("([^"]+)"/g,
          /data-number="([^"]+)"/g
        ).map(v => v.split('_')[0]);
        return numbers.map(number => ({ range, number }));
      } catch { return []; }
    })
  )).filter(r => r.status === "fulfilled").flatMap(r => r.value);

  // Step 3: ALL numbers (from ALL ranges) in one big batch — 50 at a time = ~2s for 500
  const allRows = await batchParallel(rangeNumberPairs, async ({ range, number }) => {
    const b3 = new URLSearchParams({ _token: token, start: today, end: today, Number: number, Range: range }).toString();
    try {
      const r3 = await withTimeout(makeRequest("POST", "/portal/sms/received/getsms/number/sms", b3,
        "application/x-www-form-urlencoded",
        { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
      ), 8000);
      return parseSMSMessages(r3.body, range, number, today);
    } catch { return []; }
  }, 50);

  return {
    sEcho:                1,
    iTotalRecords:        String(allRows.length),
    iTotalDisplayRecords: String(allRows.length),
    aaData:               allRows
  };
}

/* ── GET NUMBERS ── */
async function getNumbers(token) {
  const ts   = Date.now();
  const path = `/portal/numbers?draw=1`
    + `&columns[0][data]=number_id&columns[0][name]=id&columns[0][orderable]=false`
    + `&columns[1][data]=Number&columns[2][data]=range&columns[3][data]=A2P`
    + `&columns[4][data]=LimitA2P&columns[5][data]=limit_cli_a2p`
    + `&columns[6][data]=limit_cli_did_a2p`
    + `&columns[7][data]=action&columns[7][searchable]=false&columns[7][orderable]=false`
    + `&order[0][column]=1&order[0][dir]=desc&start=0&length=5000&search[value]=&_=${ts}`;

  const resp = await makeRequest("GET", path, null, null, {
    "Referer": `${BASE_URL}/portal/numbers`,
    "Accept":  "application/json, text/javascript, */*; q=0.01"
  });

  const json = safeJSON(resp.body);
  if (!json?.data) return json;

  const aaData = json.data.map(row => [row.range||"", "", String(row.Number||""), "Weekly", ""]);

  return {
    sEcho:                2,
    iTotalRecords:        String(json.recordsTotal    || aaData.length),
    iTotalDisplayRecords: String(json.recordsFiltered || aaData.length),
    aaData
  };
}

/* ── ROUTES ── */
router.get("/", async (req, res) => {
  const { type } = req.query;
  if (!type) return res.json({ error: "Use ?type=sms or ?type=numbers" });

  try {
    const token = await fetchToken();
    if (!token) return res.status(401).json({ error: "Session expired — update cookies" });

    if (type === "sms")     return res.json(await getSMS(token));
    if (type === "numbers") return res.json(await getNumbers(token));

    res.json({ error: "Use ?type=sms or ?type=numbers" });
  } catch (err) {
    if (err.message === "SESSION_EXPIRED")
      return res.status(401).json({ error: "Session expired — update cookies" });
    res.status(500).json({ error: err.message });
  }
});

router.post("/update-session", express.json(), (req, res) => {
  const { xsrf, session } = req.body || {};
  if (!xsrf || !session) return res.status(400).json({ error: "Required: xsrf and session" });
  COOKIES["XSRF-TOKEN"]       = xsrf;
  COOKIES["ivas_sms_session"] = session;
  cachedToken = null;
  res.json({ success: true });
});

router.get("/status", async (req, res) => {
  try {
    const token = await fetchToken();
    res.json({ status: token ? "✅ Active" : "❌ Expired", hasToken: !!token });
  } catch (e) {
    res.json({ status: "❌ Expired", error: e.message });
  }
});

/* ── DEBUG ROUTE — check exact HTML structure ── */
router.get("/debug-sms", async (req, res) => {
  try {
    const token    = await fetchToken();
    if (!token) return res.status(401).json({ error: "Session expired" });
    const today    = getToday();
    const boundary = "----WebKitFormBoundary6I2Js7TBhcJuwIqw";
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="from"\r\n\r\n${today}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="to"\r\n\r\n${today}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="_token"\r\n\r\n${token}`,
      `--${boundary}--`
    ].join("\r\n");

    // Level 1
    const r1 = await makeRequest("POST", "/portal/sms/received/getsms", parts,
      `multipart/form-data; boundary=${boundary}`,
      { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
    );

    const ranges = extractAll(r1.body,
      /toggleRange\('([^']+)'/g,
      /toggleRange\("([^"]+)"/g,
      /data-range="([^"]+)"/g
    );

    if (ranges.length === 0) {
      return res.json({ step: "L1_NO_RANGES", html_preview: r1.body.substring(0, 1000) });
    }

    // Level 2 — first range only
    const range = ranges[0];
    const b2 = new URLSearchParams({ _token: token, start: today, end: today, range }).toString();
    const r2 = await makeRequest("POST", "/portal/sms/received/getsms/number", b2,
      "application/x-www-form-urlencoded",
      { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
    );

    const numbers = extractAll(r2.body,
      /toggleNum\w*\('(\d+)'/g,
      /toggleNum\w*\("(\d+)"/g,
      /toggleNum[^(]*\('([^']+)'/g,
      /data-number="(\d+)"/g
    ).map(v => v.split('_')[0]);

    if (numbers.length === 0) {
      return res.json({ step: "L2_NO_NUMBERS", range, html_preview: r2.body.substring(0, 1000) });
    }

    // Level 3 — first number only
    const number = numbers[0];
    const b3 = new URLSearchParams({ _token: token, start: today, end: today, Number: number, Range: range }).toString();
    const r3 = await makeRequest("POST", "/portal/sms/received/getsms/number/sms", b3,
      "application/x-www-form-urlencoded",
      { "Referer": `${BASE_URL}/portal/sms/received`, "Accept": "text/html, */*; q=0.01" }
    );

    const parsed = parseSMSMessages(r3.body, range, number, today);

    return res.json({
      step:          "L3_DONE",
      range,
      number,
      parsed_count:  parsed.length,
      parsed,
      html_preview:  r3.body.substring(0, 2000)
    });

  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;