const db = require('./db');

const apiKeyAuth = async (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing API Key' });

  // 1. Get user + plan info from DB
  const [[user]] = await db.query(`
    SELECT users.*, plans.name AS plan_name, plans.daily_limit, plans.min_interval, plans.update_interval, plans.history_days
    FROM users
    JOIN plans ON users.plan_id = plans.id
    WHERE users.api_key = ?
  `, [key]);

  if (!user) return res.status(403).json({ error: 'Invalid API Key' });

  // 2. Check daily quota
  const [[{ count }]] = await db.query(`
    SELECT COUNT(*) AS count
    FROM api_usage
    WHERE user_id = ? AND DATE(timestamp) = CURDATE()
  `, [user.id]);

  if (count >= user.daily_limit) {
    return res.status(429).json({ error: 'Daily API limit reached' });
  }

  // 3. Check minimum interval
  const [[last]] = await db.query(`
    SELECT timestamp
    FROM api_usage
    WHERE user_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `, [user.id]);

  if (last && last.timestamp) {
    const lastTime = new Date(last.timestamp);
    const now = new Date();
    const diffMin = (now - lastTime) / (1000 * 60);
    if (diffMin < user.min_interval) {
      return res.status(429).json({
        error: `Wait ${Math.ceil(user.min_interval - diffMin)} more minutes before next request`
      });
    }
  }

  // 4. Log usage
  await db.query(`
    INSERT INTO api_usage (user_id, endpoint, timestamp)
    VALUES (?, ?, NOW())
  `, [user.id, req.originalUrl]);

  // 5. Pass user info to next route
  req.user = user;
  next();
};

module.exports = apiKeyAuth;
