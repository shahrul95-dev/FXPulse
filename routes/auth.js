const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');
require('dotenv').config();

const router = express.Router();

// Helper: Generate secure random API key
const generateApiKey = () => [...Array(32)].map(() => Math.random().toString(36)[2]).join('');

router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
      const [[existing]] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) return res.status(409).json({ error: 'Email already registered' });
  
      const hashedPassword = await bcrypt.hash(password, 10);
      const apiKey = generateApiKey();
      const token = crypto.randomBytes(32).toString('hex');
      const verifyLink = `${process.env.APP_URL}/auth/verify?token=${token}&email=${email}`;
  
      await db.query(`
        INSERT INTO users (name, email, password, api_key, plan_id, verification_token)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [name, email, hashedPassword, apiKey, 1, token]);
  
      await sendEmail(email, 'Verify your email', `
        <h2>Hello ${name}</h2>
        <p>Click below to verify your email:</p>
        <a href="${verifyLink}">Verify Email</a>
      `);
  
      res.status(201).json({ message: 'Registration successful, please check your email to verify.' });
    } catch (err) {
      res.status(500).json({ error: 'Registration failed', details: err.message });
    }
  });

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [[user]] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (!user.is_verified) {
        return res.status(403).json({ error: 'Please verify your email before logging in.' });
      }

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d'
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        name: user.name,
        email: user.email,
        api_key: user.api_key,
        plan_id: user.plan_id
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

router.get('/verify', async (req, res) => {
    const { email, token } = req.query;
  
    try {
      const [[user]] = await db.query('SELECT * FROM users WHERE email = ? AND verification_token = ?', [email, token]);
  
      if (!user) return res.status(400).send('Invalid or expired token.');
  
      await db.query('UPDATE users SET is_verified = 1, verification_token = NULL WHERE email = ?', [email]);
  
      res.send('Email verified successfully. You can now log in.');
    } catch (err) {
      res.status(500).send('Verification failed.');
    }
  });

  router.post('/resend-verification', async (req, res) => {
    const { email } = req.body;
    try {
      const [[user]] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
      if (!user) return res.status(404).json({ error: 'User not found' });
  
      if (user.is_verified) {
        return res.status(400).json({ error: 'User already verified' });
      }
  
      const token = crypto.randomBytes(32).toString('hex');
      const verifyLink = `${process.env.APP_URL}/auth/verify?token=${token}&email=${email}`;
  
      await db.query('UPDATE users SET verification_token = ? WHERE email = ?', [token, email]);
  
      await sendEmail(email, 'Verify your email', `
        <h2>Hello ${user.name}</h2>
        <p>Click the link below to verify your email:</p>
        <a href="${verifyLink}">Verify Email</a>
      `);
  
      res.json({ message: 'Verification email resent. Please check your inbox.' });
    } catch (err) {
      res.status(500).json({ error: 'Could not resend verification email', details: err.message });
    }
  });

  
module.exports = router;
