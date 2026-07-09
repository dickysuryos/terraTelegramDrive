import express from 'express';
import session from 'express-session';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import bcrypt from 'bcryptjs';
import mime from 'mime-types';
import { getPool } from './db.js';

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function createServer(bot, shareBot = null) {
  const app = express();

  let shareBotUsername = null;
  if (shareBot) {
    shareBot.telegram.getMe().then(info => {
      shareBotUsername = info.username;
      console.log(`[STARTUP] Share Bot username resolved to: @${shareBotUsername}`);
    }).catch(err => {
      console.error('[STARTUP] Failed to resolve Share Bot username:', err);
    });
  }

  // Basic configurations
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session configuration
  // TODO(security): In production over HTTPS, use secure: true and rename to '__Host-drive-session'
  const isProd = process.env.NODE_ENV === 'production';
  const sessionCookieName = isProd ? '__Host-drive-session' : 'drive-session';

  app.use(
    session({
      name: sessionCookieName,
      secret: process.env.SESSION_SECRET || 'ephemeral-session-secret-key-123456789',
      resave: true,
      saveUninitialized: true,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    })
  );

  // Security Headers Middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'"
    );
    next();
  });

  // Serve Web Portal static UI files
  app.use(express.static(path.resolve('public')));

  // Authentication Middleware
  function requireAuth(req, res, next) {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    next();
  }

  // CSRF Protection Middleware
  function csrfCheck(req, res, next) {
    const csrfTokenHeader = req.headers['x-csrf-token'];
    const csrfTokenSession = req.session.csrfToken;
    if (!csrfTokenSession || csrfTokenHeader !== csrfTokenSession) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
    }
    next();
  }

  // Helper: Get user details from DB to refresh session variables
  async function refreshUserSession(req) {
    if (!req.session.user) return null;
    const pool = getPool();
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    if (users.length > 0) {
      req.session.user = {
        id: users[0].id,
        username: users[0].username,
        telegram_chat_id: users[0].telegram_chat_id
      };
      return req.session.user;
    }
    return null;
  }

  // Auth Routes
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
      const pool = getPool();
      const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      const user = rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      // Establish session
      req.session.user = {
        id: user.id,
        username: user.username,
        telegram_chat_id: user.telegram_chat_id
      };

      // Generate CSRF Token
      const csrfToken = crypto.randomUUID();
      req.session.csrfToken = csrfToken;

      // Send CSRF Token via standard cookie (readable by JS)
      res.cookie('csrf-token', csrfToken, {
        secure: false, // Set to true if running over HTTPS
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ error: 'Failed to establish session.' });
        }
        res.json({ success: true, user: req.session.user, shareBotUsername });
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  app.post('/api/auth/logout', requireAuth, csrfCheck, (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to log out.' });
      }
      res.clearCookie(sessionCookieName);
      res.clearCookie('csrf-token');
      res.json({ success: true });
    });
  });

  app.get('/api/auth/me', async (req, res) => {
    if (!req.session.user) {
      return res.json({ loggedIn: false });
    }
    const user = await refreshUserSession(req);
    if (!user) {
      return req.session.destroy(() => {
        res.clearCookie(sessionCookieName);
        res.clearCookie('csrf-token');
        res.json({ loggedIn: false });
      });
    }
    req.session.save((err) => {
      if (err) {
        console.error('Session save error in me endpoint:', err);
        return res.status(500).json({ error: 'Failed to refresh session.' });
      }
      res.json({ loggedIn: true, user, csrfToken: req.session.csrfToken, shareBotUsername });
    });
  });

  // Account linking token generator (Method 1 linking support)
  app.post('/api/auth/link-token', requireAuth, csrfCheck, async (req, res) => {
    try {
      const token = crypto.randomBytes(16).toString('hex');
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes lifetime
      const pool = getPool();

      await pool.query(
        'UPDATE users SET telegram_link_token = ?, telegram_link_expires = ? WHERE id = ?',
        [token, expires, req.session.user.id]
      );

      // Fetch bot username from Telegram
      const botInfo = await bot.telegram.getMe();
      const linkUrl = `https://t.me/${botInfo.username}?start=link_${token}`;

      res.json({ linkUrl });
    } catch (error) {
      console.error('Error generating link token:', error);
      res.status(500).json({ error: 'Failed to generate link token.' });
    }
  });

  // Multer upload settings (saves temporarily inside temp/)
  const tempDir = path.resolve('temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, tempDir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${crypto.randomUUID()}${ext}`);
      }
    }),
    limits: { fileSize: 300 * 1024 * 1024 } // limit: 300MB
  });

  // Upload File (Method 1 Web upload)
  app.post('/api/files/upload', requireAuth, csrfCheck, upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const tempFilePath = req.file.path;
    const originalName = req.file.originalname;
    const size = req.file.size;
    const folder = req.body.folder || '/';

    const user = await refreshUserSession(req);
    if (!user || !user.telegram_chat_id) {
      // Clean up temp file
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
      return res.status(400).json({ error: 'Please link your Telegram Bot in settings before uploading files.' });
    }

    try {
      // 1. Calculate SHA256 of local temporary file
      const fileBuffer = fs.readFileSync(tempFilePath);
      const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // 2. Upload file to Telegram Bot API
      const tgDoc = await bot.telegram.sendDocument(
        user.telegram_chat_id,
        { source: tempFilePath, filename: originalName }
      );

      const fileId = tgDoc.document.file_id;
      const fileUniqueId = tgDoc.document.file_unique_id;
      const messageId = tgDoc.message_id;

      // Extract file details
      const fileExt = originalName.includes('.') ? path.extname(originalName).toLowerCase().substring(1) : '';
      const mimeType = req.file.mimetype || mime.lookup(originalName) || 'application/octet-stream';

      const fileRecordId = crypto.randomUUID();
      const pool = getPool();

      // 3. Save metadata to MySQL
      await pool.query(
        `INSERT INTO files (id, name, extension, mime_type, size, sha256, telegram_file_id, telegram_unique_id, telegram_message_id, telegram_chat_id, source, folder, tags, user_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fileRecordId,
          originalName,
          fileExt,
          mimeType,
          size,
          sha256Hash,
          fileId,
          fileUniqueId,
          messageId,
          user.telegram_chat_id,
          'web',
          folder,
          JSON.stringify([]),
          user.id
        ]
      );

      // Send nice Telegram confirmation card
      const sizeStr = (size / (1024 * 1024)).toFixed(1) + ' MB';
      await bot.telegram.sendMessage(
        user.telegram_chat_id,
        `📤 <b>Uploaded from Web:</b>\n\n` +
        `📁 Folder: <code>${escapeHtml(folder)}</code>\n\n` +
        `📄 Name: <code>${escapeHtml(originalName)}</code>\n\n` +
        `📦 Size: <b>${sizeStr}</b>\n\n` +
        `🏷 Tags: None`,
        { parse_mode: 'HTML' }
      );

      res.json({ success: true, file: { id: fileRecordId, name: originalName } });
    } catch (error) {
      console.error('Web upload error:', error);
      if (error.response && error.response.error_code === 413) {
        return res.status(413).json({ 
          error: 'File size exceeds standard Telegram Bot API limit (50MB). To upload files up to 300MB via Web, you must run a Local Telegram Bot API Server.' 
        });
      }
      res.status(500).json({ error: 'Failed to process and upload file.' });
    } finally {
      // 4. ALWAYS remove temp file immediately
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (e) {
        console.error('Failed to delete temp file:', e);
      }
    }
  });

  // URL Import (Method 4)
  app.post('/api/files/import', requireAuth, csrfCheck, async (req, res) => {
    const { url, folder } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required.' });
    }

    // SSRF Safeguards
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'Only HTTP/HTTPS protocols are supported.' });
      }
      const hostname = parsedUrl.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '10.0.3.20'
      ) {
        return res.status(400).json({ error: 'Access to internal addresses is restricted.' });
      }
    } catch (err) {
      return res.status(400).json({ error: 'Invalid URL format.' });
    }

    const user = await refreshUserSession(req);
    if (!user || !user.telegram_chat_id) {
      return res.status(400).json({ error: 'Please link your Telegram Bot in settings before importing.' });
    }

    const tempFileName = crypto.randomUUID();
    const tempFilePath = path.join(tempDir, tempFileName);

    try {
      // 1. Download file from URL
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(400).json({ error: `URL fetch failed: ${response.statusText}` });
      }

      // Extract filename
      let fileName = 'imported_file';
      const cdHeader = response.headers.get('content-disposition');
      if (cdHeader) {
        const match = cdHeader.match(/filename\*?=["']?(?:UTF-8'')?([^;"']+)["']?/i);
        if (match && match[1]) {
          fileName = decodeURIComponent(match[1]);
        } else {
          const match2 = cdHeader.match(/filename=["']?([^;"']+)["']?/i);
          if (match2 && match2[1]) {
            fileName = match2[1];
          }
        }
      } else {
        const pathname = parsedUrl.pathname;
        const base = path.basename(pathname);
        if (base && base !== '/') {
          fileName = base;
        }
      }

      const mimeType = response.headers.get('content-type') || mime.lookup(fileName) || 'application/octet-stream';
      const ext = fileName.includes('.') ? path.extname(fileName).toLowerCase().substring(1) : '';

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(tempFilePath, buffer);
      const size = buffer.length;

      // SHA256
      const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

      // 2. Upload to Telegram
      const tgDoc = await bot.telegram.sendDocument(
        user.telegram_chat_id,
        { source: tempFilePath, filename: fileName }
      );

      const fileRecordId = crypto.randomUUID();
      const folderPath = folder || '/';
      const pool = getPool();

      // 3. Save metadata
      await pool.query(
        `INSERT INTO files (id, name, extension, mime_type, size, sha256, telegram_file_id, telegram_unique_id, telegram_message_id, telegram_chat_id, source, folder, tags, user_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fileRecordId,
          fileName,
          ext,
          mimeType,
          size,
          sha256Hash,
          tgDoc.document.file_id,
          tgDoc.document.file_unique_id,
          tgDoc.message_id,
          user.telegram_chat_id,
          'import',
          folderPath,
          JSON.stringify([]),
          user.id
        ]
      );

      // Bot message
      const sizeStr = (size / (1024 * 1024)).toFixed(1) + ' MB';
      await bot.telegram.sendMessage(
        user.telegram_chat_id,
        `📥 <b>Imported via URL:</b>\n\n` +
        `📁 Folder: <code>${escapeHtml(folderPath)}</code>\n\n` +
        `📄 Name: <code>${escapeHtml(fileName)}</code>\n\n` +
        `📦 Size: <b>${sizeStr}</b>\n\n` +
        `🏷 Tags: None`,
        { parse_mode: 'HTML' }
      );

      res.json({ success: true, fileId: fileRecordId, name: fileName });
    } catch (error) {
      console.error('URL Import error:', error);
      res.status(500).json({ error: 'Failed to import URL.' });
    } finally {
      // Clean up local temp file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (e) {}
    }
  });

  // Get User Files (List files by folder and query search)
  app.get('/api/files', requireAuth, async (req, res) => {
    const { folder = '/', search = '', trash = 'false' } = req.query;
    const showTrash = trash === 'true';

    try {
      const pool = getPool();
      let queryStr = '';
      const params = [req.session.user.id];

      if (showTrash) {
        queryStr = 'SELECT * FROM files WHERE user_id = ? AND is_trashed = TRUE';
      } else if (search) {
        queryStr = `SELECT * FROM files 
                    WHERE user_id = ? AND is_trashed = FALSE 
                      AND (name LIKE ? OR JSON_CONTAINS(tags, JSON_QUOTE(?)))`;
        params.push(`%${search}%`, search);
      } else {
        queryStr = 'SELECT * FROM files WHERE user_id = ? AND folder = ? AND is_trashed = FALSE';
        params.push(folder);
      }

      queryStr += ' ORDER BY created_at DESC';

      const [files] = await pool.query(queryStr, params);

      // Return tags parsed if SQL returns string
      const formattedFiles = files.map(file => {
        let tagsArr = [];
        try {
          tagsArr = Array.isArray(file.tags) ? file.tags : JSON.parse(file.tags || '[]');
        } catch (e) {}
        return {
          ...file,
          tags: tagsArr
        };
      });

      res.json({ files: formattedFiles });
    } catch (error) {
      console.error('Error fetching files:', error);
      res.status(500).json({ error: 'Failed to query files.' });
    }
  });

  // Download File (Method 1 and streaming interface)
  app.get('/api/files/download/:id', requireAuth, async (req, res) => {
    try {
      const fileId = req.params.id;
      const pool = getPool();

      // Check ownership
      const [files] = await pool.query('SELECT * FROM files WHERE id = ? AND user_id = ?', [
        fileId,
        req.session.user.id
      ]);

      if (files.length === 0) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const file = files[0];

      // Download from Telegram
      const fileInfo = await bot.telegram.getFile(file.telegram_file_id);
      
      // If the file is stored locally (when using local Bot API with shared volumes)
      if (fileInfo.file_path && fs.existsSync(fileInfo.file_path)) {
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
        if (file.mime_type) {
          res.setHeader('Content-Type', file.mime_type);
        }
        return res.sendFile(fileInfo.file_path);
      }

      const apiRoot = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
      const fileUrl = `${apiRoot}/file/bot${bot.token}/${fileInfo.file_path}`;

      // Check for Range header from client and forward it to Telegram
      const headers = {};
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const response = await fetch(fileUrl, { headers });
      if (!response.ok && response.status !== 206) {
        throw new Error(`Failed to fetch file from Telegram: ${response.statusText}`);
      }

      // Forward status and range response headers back to client
      res.status(response.status);
      
      const headersToForward = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges'
      ];
      headersToForward.forEach(header => {
        const value = response.headers.get(header);
        if (value) {
          res.setHeader(header, value);
        }
      });

      // Ensure inline content disposition so browsers play/preview rather than force download
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // Stream blocks back to client
      const readable = Readable.fromWeb(response.body);
      readable.pipe(res);
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ error: 'Failed to stream download.' });
    }
  });

  // Delete / Trash File
  app.delete('/api/files/:id', requireAuth, csrfCheck, async (req, res) => {
    const fileId = req.params.id;
    const { permanent = 'false' } = req.query;
    const isPermanent = permanent === 'true';

    try {
      const pool = getPool();
      // Check ownership
      const [files] = await pool.query('SELECT * FROM files WHERE id = ? AND user_id = ?', [
        fileId,
        req.session.user.id
      ]);

      if (files.length === 0) {
        return res.status(404).json({ error: 'File not found.' });
      }

      if (isPermanent) {
        await pool.query('DELETE FROM files WHERE id = ?', [fileId]);
        res.json({ success: true, message: 'File deleted permanently.' });
      } else {
        await pool.query('UPDATE files SET is_trashed = TRUE WHERE id = ?', [fileId]);
        res.json({ success: true, message: 'File moved to trash.' });
      }
    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({ error: 'Failed to delete file.' });
    }
  });

  // Update File Folder / Tags / Restore
  app.patch('/api/files/:id', requireAuth, csrfCheck, async (req, res) => {
    const fileId = req.params.id;
    const { folder, tags, is_trashed } = req.body;

    try {
      const pool = getPool();
      // Check ownership
      const [files] = await pool.query('SELECT * FROM files WHERE id = ? AND user_id = ?', [
        fileId,
        req.session.user.id
      ]);

      if (files.length === 0) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const updates = [];
      const params = [];

      if (folder !== undefined) {
        let cleanFolder = folder;
        if (!cleanFolder.startsWith('/')) cleanFolder = '/' + cleanFolder;
        if (cleanFolder.endsWith('/') && cleanFolder.length > 1) cleanFolder = cleanFolder.slice(0, -1);

        updates.push('folder = ?');
        params.push(cleanFolder);
      }

      if (tags !== undefined) {
        if (!Array.isArray(tags)) {
          return res.status(400).json({ error: 'Tags must be an array.' });
        }
        updates.push('tags = ?');
        params.push(JSON.stringify(tags));
      }

      if (is_trashed !== undefined) {
        updates.push('is_trashed = ?');
        params.push(is_trashed ? 1 : 0);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update.' });
      }

      params.push(fileId);
      await pool.query(`UPDATE files SET ${updates.join(', ')} WHERE id = ?`, params);

      res.json({ success: true });
    } catch (error) {
      console.error('Update patch error:', error);
      res.status(500).json({ error: 'Failed to update file.' });
    }
  });

  // List unique folders for navigation sidebar / dropdowns
  app.get('/api/folders', requireAuth, async (req, res) => {
    try {
      const pool = getPool();
      const [rows] = await pool.query(
        'SELECT DISTINCT folder FROM files WHERE user_id = ? AND is_trashed = FALSE ORDER BY folder ASC',
        [req.session.user.id]
      );
      const folders = rows.map(r => r.folder);
      // Ensure root folder '/' is always in the list
      if (!folders.includes('/')) {
        folders.unshift('/');
      }
      res.json({ folders });
    } catch (error) {
      console.error('Folders listing error:', error);
      res.status(500).json({ error: 'Failed to fetch folders.' });
    }
  });

  // Storage Stats Analysis
  app.get('/api/stats', requireAuth, async (req, res) => {
    try {
      const pool = getPool();
      const userId = req.session.user.id;

      const [[{ total_files }]] = await pool.query('SELECT COUNT(*) as total_files FROM files WHERE user_id = ? AND is_trashed = FALSE', [userId]);
      const [[{ total_size }]] = await pool.query('SELECT COALESCE(SUM(size), 0) as total_size FROM files WHERE user_id = ? AND is_trashed = FALSE', [userId]);
      const [[{ trashed_files }]] = await pool.query('SELECT COUNT(*) as trashed_files FROM files WHERE user_id = ? AND is_trashed = TRUE', [userId]);

      // Size grouped by mime categories (Image, Video, Audio, Document, Others)
      const [mimeStats] = await pool.query(
        `SELECT 
           CASE 
             WHEN mime_type LIKE 'image/%' THEN 'Images'
             WHEN mime_type LIKE 'video/%' THEN 'Videos'
             WHEN mime_type LIKE 'audio/%' THEN 'Audio'
             WHEN mime_type LIKE 'application/pdf' OR mime_type LIKE '%word%' OR mime_type LIKE '%excel%' OR mime_type LIKE '%powerpoint%' OR mime_type LIKE '%epub%' THEN 'Documents'
             ELSE 'Others'
           END as category,
           COALESCE(SUM(size), 0) as total_size,
           COUNT(*) as count
         FROM files 
         WHERE user_id = ? AND is_trashed = FALSE
         GROUP BY category`,
        [userId]
      );

      res.json({
        totalFiles: total_files,
        totalSize: parseInt(total_size, 10),
        trashedFiles: trashed_files,
        mimeStats
      });
    } catch (error) {
      console.error('Stats query error:', error);
      res.status(500).json({ error: 'Failed to query stats.' });
    }
  });

  return app;
}
