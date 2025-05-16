const db = require('../db');

async function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

  try {
    const [[user]] = await db.query('SELECT * FROM users WHERE api_key = ?', [apiKey]);

    if (!user) return res.status(403).json({ error: 'Invalid API key' });
    if (!user.is_verified) return res.status(403).json({ error: 'Email not verified' });

    req.user = user; // Attach user info to request
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth failed', details: err.message });
  }
}

module.exports = apiKeyAuth;
