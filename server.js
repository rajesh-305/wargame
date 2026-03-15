const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'game.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      mobile TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.all('PRAGMA table_info(users)', [], (err, rows) => {
    if (err) return;
    const columns = new Set(rows.map((r) => r.name));
    if (!columns.has('email')) {
      db.run('ALTER TABLE users ADD COLUMN email TEXT');
    }
    if (!columns.has('mobile')) {
      db.run('ALTER TABLE users ADD COLUMN mobile TEXT');
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS game_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total_bombs INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS country_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_score_id INTEGER NOT NULL,
      country_name TEXT NOT NULL,
      bombs INTEGER NOT NULL,
      FOREIGN KEY (game_score_id) REFERENCES game_scores(id)
    )
  `);
});

app.use(express.json());
app.use(express.static(__dirname));
const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({
    db: process.env.SESSION_DB_FILE || 'sessions.db',
    dir: dataDir
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const mobile = String(req.body.mobile || '').trim();
    const password = String(req.body.password || '');

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 3-30 characters.' });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    if (!/^\d{10,15}$/.test(mobile)) {
      return res.status(400).json({ error: 'Mobile number must be 10-15 digits.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const hash = await bcrypt.hash(password, 10);

    db.get(
      'SELECT id FROM users WHERE username = ? OR email = ? OR mobile = ?',
      [username, email, mobile],
      (findErr, existing) => {
        if (findErr) {
          return res.status(500).json({ error: 'Database error.' });
        }
        if (existing) {
          return res.status(409).json({ error: 'Username, email, or mobile already exists.' });
        }

        db.run(
          'INSERT INTO users (username, email, mobile, password_hash) VALUES (?, ?, ?, ?)',
          [username, email, mobile, hash],
          function (err) {
            if (err) {
              if (err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'Username, email, or mobile already exists.' });
              }
              return res.status(500).json({ error: 'Database error.' });
            }

            return res.json({
              ok: true,
              message: 'Registration successful. Please login with your credentials.'
            });
          }
        );
      }
    );
  } catch {
    return res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!user) return res.status(401).json({ error: 'User not found. Please register first.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    req.session.user = { id: user.id, username: user.username };
    return res.json({ user: req.session.user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/scores', requireAuth, (req, res) => {
  const countries = Array.isArray(req.body.countries) ? req.body.countries : [];
  const durationSeconds = Number(req.body.durationSeconds || 0);

  if (!countries.length) {
    return res.status(400).json({ error: 'No country score data provided.' });
  }

  const totalBombs = countries.reduce((sum, c) => sum + Number(c.bombCount || 0), 0);

  db.run(
    'INSERT INTO game_scores (user_id, total_bombs, duration_seconds) VALUES (?, ?, ?)',
    [req.session.user.id, totalBombs, durationSeconds],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to save game score.' });

      const gameScoreId = this.lastID;
      const stmt = db.prepare('INSERT INTO country_scores (game_score_id, country_name, bombs) VALUES (?, ?, ?)');
      for (const c of countries) {
        stmt.run([gameScoreId, String(c.name), Number(c.bombCount || 0)]);
      }
      stmt.finalize((finErr) => {
        if (finErr) return res.status(500).json({ error: 'Failed to save country scores.' });
        return res.json({ ok: true, gameScoreId, totalBombs });
      });
    }
  );
});

app.get('/api/my-scores', requireAuth, (req, res) => {
  db.all(
    `SELECT id, total_bombs AS totalBombs, duration_seconds AS durationSeconds, created_at AS createdAt
     FROM game_scores
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 10`,
    [req.session.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to load score history.' });
      return res.json({ scores: rows });
    }
  );
});

app.get('/api/leaderboard', (req, res) => {
  db.all(
    `SELECT u.username, MAX(gs.total_bombs) AS bestBombs
     FROM game_scores gs
     JOIN users u ON u.id = gs.user_id
     GROUP BY gs.user_id
     ORDER BY bestBombs DESC
     LIMIT 10`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to load leaderboard.' });
      return res.json({ leaderboard: rows });
    }
  );
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
