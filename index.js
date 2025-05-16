const express = require('express');
const axios = require('axios');
const config = require('./config');
const db = require('./db');
const authRoutes = require('./routes/auth');
const apiKeyAuth = require('./middleware/apiKeyAuth');

const router = express.Router();

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

const port = 3000;

let memoryStore = {}; // Cached exchange rates
let apiKeyIndex = 0;

// Rotate to next API key
function getNextApiKey() {
  const keys = config.apiKeys;
  const key = keys[apiKeyIndex % keys.length];
  return key;
}


// Store or update into DB
async function upsertRate(base, target, rate) {
  const now = new Date();
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      INSERT INTO exchange_rates (base_currency, target_currency, rate, updated_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        rate = VALUES(rate),
        updated_at = VALUES(updated_at)
    `, [base, target, rate, now]);
  } catch (err) {
    console.error(`DB error for ${base}/${target}:`, err.message);
  } finally {
    conn.release();
  }
}

async function fetchRates() {
  const base = config.baseCurrency;

  for (let i = 0; i < config.currencies.length; i++) {
      if (i % 2 === 0 && i !== 0) {
        // Change API key every 2 requests
        apiKeyIndex++;
      }

      const apiKey = getNextApiKey();
      const to = config.currencies[i];

      try {
        const url = `https://api.twelvedata.com/exchange_rate?symbol=${base}/${to}&apikey=${apiKey}`;
        const response = await axios.get(url);
        const rate = parseFloat(response.data.rate);
        const now = new Date().toISOString();

        memoryStore[`${base}_${to}`] = { rate, updated_at: now };

        await upsertRate(base, to, rate);       // Live update
        await saveToHistory(base, to, rate);    // History insert

        // console.log(`[DB Updated] ${base} → ${to}: ${rate}`);

        if (isNaN(rate)) {
          console.log(response);
        }

      } catch (error) {
        console.error(`Error fetching ${base}->${to}:`, error.message);
      }

    var recordedNow = new Date().toISOString();

    console.log(`[DB Updated] at ${recordedNow}`);

    }
  }
  

  async function saveToHistory(base, target, rate) {
    const now = new Date();
    const conn = await db.getConnection();
    try {
      await conn.execute(`
        INSERT INTO exchange_history (base_currency, target_currency, rate, timestamp)
        VALUES (?, ?, ?, ?)
      `, [base, target, rate, now]);
    } catch (err) {
      console.error(`History insert error: ${base}->${target}`, err.message);
    } finally {
      conn.release();
    }
  }

  
// Refresh every 5 minutesnpm run sta
setInterval(fetchRates, 5 * 60 * 1000);
fetchRates(); // Run immediately on start

// Simple API to expose rates
app.get('/rates', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM exchange_rates ORDER BY target_currency');
  res.json(rows);
});


router.get('/convert', apiKeyAuth, async (req, res) => {
    const { base, target } = req.query;
    const user = req.user;
  
    if (!base || !target) {
      return res.status(400).json({ error: 'base and target currencies required' });
    }
  
    const now = new Date();
    const intervalMinutes = user.update_interval;
  
    // Check if we already have a recent rate
    const [[cached]] = await db.query(`
      SELECT rate, timestamp FROM exchange_history
      WHERE base_currency = ? AND target_currency = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `, [base, target]);
  
    let shouldFetch = true;
    if (cached && cached.timestamp) {
      const lastUpdated = new Date(cached.timestamp);
      const diffMin = (now - lastUpdated) / (1000 * 60);
      if (diffMin < intervalMinutes) {
        shouldFetch = false;
      }
    }
  
    if (!shouldFetch && cached) {
      return res.json({
        source: 'cache',
        rate: cached.rate,
        base,
        target,
        timestamp: cached.timestamp
      });
    }
  
    // Fetch fresh rate from TwelveData
    try {
      const apiKey = getRotatedApiKey(); // function you created earlier
      const { data } = await axios.get(`https://api.twelvedata.com/exchange_rate`, {
        params: { symbol: `${base}/${target}`, apikey: apiKey }
      });
  
      if (data.status === 'error') throw new Error(data.message);
  
      const rate = parseFloat(data.rate);
      const timestamp = new Date();
  
      await db.query(`
        INSERT INTO exchange_history (base_currency, target_currency, rate, timestamp)
        VALUES (?, ?, ?, ?)
      `, [base, target, rate, timestamp]);
  
      return res.json({
        source: 'live',
        rate,
        base,
        target,
        timestamp
      });
  
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch rate', details: err.message });
    }
  });

  router.get('/convert-historical', apiKeyAuth, async (req, res) => {
    const { base, target, date } = req.query;
    const user = req.user;
  
    if (!base || !target || !date) {
      return res.status(400).json({ error: 'base, target and date are required' });
    }
  
    const requestedDate = new Date(date);
    const now = new Date();
    const diffDays = (now - requestedDate) / (1000 * 60 * 60 * 24);
  
    if (diffDays > user.history_days) {
      return res.status(403).json({ error: `This plan only supports up to ${user.history_days} days of history` });
    }
  
    const intervalMinutes = user.update_interval;
  
    // Check for existing cached rate for that day
    const [[cached]] = await db.query(`
      SELECT rate, timestamp FROM exchange_history
      WHERE base_currency = ? AND target_currency = ? AND DATE(timestamp) = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `, [base, target, date]);
  
    let shouldFetch = true;
    if (cached) {
      const lastUpdated = new Date(cached.timestamp);
      const diffMin = (now - lastUpdated) / (1000 * 60);
      if (diffMin < intervalMinutes) {
        shouldFetch = false;
      }
    }
  
    if (!shouldFetch && cached) {
      return res.json({
        source: 'cache',
        rate: cached.rate,
        base,
        target,
        date,
        timestamp: cached.timestamp
      });
    }
  
    try {
      const apiKey = getRotatedApiKey(); // your key rotation function
      const { data } = await axios.get('https://api.twelvedata.com/exchange_rate', {
        params: {
          symbol: `${base}/${target}`,
          date,
          apikey: apiKey
        }
      });
  
      if (data.status === 'error') throw new Error(data.message);
  
      const rate = parseFloat(data.rate);
      const timestamp = new Date();
  
      await db.query(`
        INSERT INTO exchange_history (base_currency, target_currency, rate, timestamp)
        VALUES (?, ?, ?, ?)
      `, [base, target, rate, timestamp]);
  
      return res.json({
        source: 'live',
        rate,
        base,
        target,
        date,
        timestamp
      });
  
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch historical rate', details: err.message });
    }
  });
  

  
  router.get('/convert-range', apiKeyAuth, async (req, res) => {
    const { base, target, start, end } = req.query;
    const user = req.user;
  
    if (!base || !target || !start || !end) {
      return res.status(400).json({ error: 'base, target, start and end required' });
    }
  
    const intervalMinutes = user.update_interval;
    const maxHistory = user.history_days;
  
    const startDate = new Date(start);
    const endDate = new Date(end);
    const today = new Date();
  
    // Enforce history_days limit
    const diffDays = (today - startDate) / (1000 * 60 * 60 * 24);
    if (diffDays > maxHistory) {
      return res.status(403).json({ error: `Your plan allows max ${maxHistory} days of history` });
    }
  
    // Enforce limit cap
    const rangeLimit = 500;
    const [[{ count }]] = await db.query(`
      SELECT COUNT(*) AS count FROM exchange_history
      WHERE base_currency = ? AND target_currency = ? AND timestamp BETWEEN ? AND ?
    `, [base, target, startDate, endDate]);
  
    if (count > rangeLimit) {
      return res.status(400).json({ error: `Max 500 records allowed. Try a shorter date range.` });
    }
  
    // Get all existing rows in that range
    const [existingRates] = await db.query(`
      SELECT * FROM exchange_history
      WHERE base_currency = ? AND target_currency = ? AND timestamp BETWEEN ? AND ?
      ORDER BY timestamp ASC
    `, [base, target, startDate, endDate]);
  
    // Filter timestamps that are missing or outdated
    const timestampsToFetch = [];
    const expectedTimestamps = [];
  
    for (let ts = startDate.getTime(); ts <= endDate.getTime(); ts += intervalMinutes * 60000) {
      const t = new Date(ts);
      expectedTimestamps.push(t);
      const match = existingRates.find(r => Math.abs(new Date(r.timestamp) - t) < intervalMinutes * 60000 / 2);
      if (!match) {
        timestampsToFetch.push(t);
      }
    }
  
    // Fetch missing timestamps (optional, depends on your data strategy)
    // We skip fetching in this implementation for now — but log it
    if (timestampsToFetch.length > 0) {
      console.log(`Skipping fetch for ${timestampsToFetch.length} missing timestamps due to plan's update_interval policy`);
    }
  
    res.json({
      base,
      target,
      interval: `${intervalMinutes}min`,
      from: start,
      to: end,
      count: existingRates.length,
      rates: existingRates
    });
  });
  
  
app.listen(port, () => {
  console.log(`Currency API running at http://localhost:${port}`);
});
