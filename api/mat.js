const express = require('express');
const axios = require('axios');
const router = express.Router();

// --- CONFIGURATION ---
const CREDENTIALS = {
    username: "AliSindhi",
    password: "AliSindhi"
};

const BASE_URL = "http://168.119.13.175/ints";

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 15; RMX3930 Build/AP3A.240905.015.A2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.111 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "http://168.119.13.175",
    "Accept-Language": "en-PK,en-US;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate"
};

// --- GLOBAL STATE ---
let STATE = {
    cookie: null,
    csstr: null,
    isLoggingIn: false
};

// --- HELPER FUNCTIONS ---
function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function extractCsstr(html) {
    // Try to extract csstr token from page HTML
    let match = html.match(/csstr=([a-f0-9]{32})/);
    if (match) return match[1];
    match = html.match(/csstr["'\s]*[:=]["'\s]*([a-f0-9]{32})/);
    if (match) return match[1];
    return null;
}

// --- LOGIN ---
async function performLogin() {
    if (STATE.isLoggingIn) return;
    STATE.isLoggingIn = true;

    try {
        const instance = axios.create({
            headers: COMMON_HEADERS,
            timeout: 15000,
            withCredentials: true
        });

        // Step 1: GET login page → grab PHPSESSID + captcha
        const r1 = await instance.get(`${BASE_URL}/login`);

        let tempCookie = "";
        if (r1.headers['set-cookie']) {
            const c = r1.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            if (c) tempCookie = c.split(';')[0];
        }

        // Solve captcha
        const match = r1.data.match(/What is (\d+) \+ (\d+) = \?/);
        const ans = match ? parseInt(match[1]) + parseInt(match[2]) : 0;
        console.log(`🔐 MAT Login captcha answer: ${ans}`);

        // Step 2: POST signin
        const r2 = await instance.post(
            `${BASE_URL}/signin`,
            new URLSearchParams({
                username: CREDENTIALS.username,
                password: CREDENTIALS.password,
                capt: ans
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cookie": tempCookie,
                    "Referer": `${BASE_URL}/login`
                },
                maxRedirects: 0,
                validateStatus: () => true
            }
        );

        // Step 3: Save new session cookie
        if (r2.headers['set-cookie']) {
            const newC = r2.headers['set-cookie'].find(x => x.includes('PHPSESSID'));
            STATE.cookie = newC ? newC.split(';')[0] : tempCookie;
        } else {
            STATE.cookie = tempCookie;
        }

        // Step 4: Fetch CDR page to extract csstr token
        const r3 = await axios.get(`${BASE_URL}/agent/SMSCDRReports`, {
            headers: {
                ...COMMON_HEADERS,
                "Cookie": STATE.cookie,
                "Referer": `${BASE_URL}/agent/SMSDashboard`
            }
        });

        const csstr = extractCsstr(r3.data);
        if (csstr) {
            STATE.csstr = csstr;
            console.log(`✅ MAT Login OK. csstr: ${STATE.csstr}`);
        } else {
            // csstr not found in page, try dashboard
            const r4 = await axios.get(`${BASE_URL}/agent/SMSDashboard`, {
                headers: {
                    ...COMMON_HEADERS,
                    "Cookie": STATE.cookie,
                    "Referer": `${BASE_URL}/agent/`
                }
            });
            const csstr2 = extractCsstr(r4.data);
            STATE.csstr = csstr2 || null;
            console.log(`✅ MAT Login OK. csstr from dashboard: ${STATE.csstr}`);
        }

    } catch (e) {
        console.error("❌ MAT login failed:", e.message);
        STATE.cookie = null;
        STATE.csstr = null;
    } finally {
        STATE.isLoggingIn = false;
    }
}

// --- AUTO REFRESH EVERY 2 MINUTES ---
setInterval(() => performLogin(), 120000);

// --- API ROUTE ---
// GET /?type=numbers          → SMS Numbers
// GET /?type=sms              → Today's CDR
// GET /?type=sms&date=YYYY-MM-DD → Specific date CDR
router.get('/', async (req, res) => {
    const { type, date } = req.query;

    if (!STATE.cookie) {
        await performLogin();
        if (!STATE.cookie) {
            return res.status(500).json({ error: "Login failed. Try again shortly." });
        }
    }

    const ts = Date.now();
    const today = getTodayDate();
    const queryDate = date || today;

    let targetUrl = "";
    let referer = "";

    if (type === 'numbers') {
        referer = `${BASE_URL}/agent/MySMSNumbers`;
        targetUrl = `${BASE_URL}/agent/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=8&sColumns=%2C%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&mDataProp_1=1&mDataProp_2=2&mDataProp_3=3&mDataProp_4=4&mDataProp_5=5&mDataProp_6=6&mDataProp_7=7&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${ts}`;

    } else if (type === 'sms') {
        referer = `${BASE_URL}/agent/SMSCDRReports`;

        // Build CDR URL with csstr if available
        let csstrParam = STATE.csstr ? `&csstr=${STATE.csstr}` : '';
        targetUrl = `${BASE_URL}/agent/res/data_smscdr.php?fdate1=${encodeURIComponent(queryDate + ' 00:00:00')}&fdate2=${encodeURIComponent(queryDate + ' 23:59:59')}&frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgclient=&fgnumber=&fgcli=&fg=0${csstrParam}&sEcho=2&iColumns=9&sColumns=%2C%2C%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&mDataProp_1=1&mDataProp_2=2&mDataProp_3=3&mDataProp_4=4&mDataProp_5=5&mDataProp_6=6&mDataProp_7=7&mDataProp_8=8&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${ts}`;

    } else {
        return res.status(400).json({
            error: "Invalid type. Use ?type=numbers or ?type=sms",
            examples: [
                "?type=numbers",
                "?type=sms",
                "?type=sms&date=2026-04-20"
            ]
        });
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                ...COMMON_HEADERS,
                "Cookie": STATE.cookie,
                "Referer": referer
            }
        });

        // Session expired check
        if (
            typeof response.data === 'string' &&
            (response.data.includes('<html') || response.data.includes('login'))
        ) {
            console.warn("⚠️ MAT Session expired. Re-logging in...");
            STATE.cookie = null;
            STATE.csstr = null;
            await performLogin();
            return res.status(503).json({ error: "Session refreshed. Please retry." });
        }

        res.set('Content-Type', 'application/json');
        res.send(response.data);

    } catch (e) {
        if (e.response && e.response.status === 403) {
            console.warn("⚠️ MAT 403. Re-logging in...");
            STATE.cookie = null;
            STATE.csstr = null;
            await performLogin();
            return res.redirect(req.originalUrl);
        }
        res.status(500).json({ error: e.message });
    }
});

// --- EXPORT ---
module.exports = router;

// --- INITIAL LOGIN ---
performLogin();
