import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import bcrypt from 'bcryptjs';

// Test 1: Hashing credentials using bcryptjs
test('Bcrypt Password Hashing & Verification', async () => {
  const rawPassword = 'TerranovaCloudPass2026!';
  const hash = await bcrypt.hash(rawPassword, 10);

  // Ensure output is encrypted
  assert.notStrictEqual(hash, rawPassword);
  
  // Verify comparison triggers
  const isMatch = await bcrypt.compare(rawPassword, hash);
  assert.strictEqual(isMatch, true);

  const isWrongMatch = await bcrypt.compare('WrongPass123', hash);
  assert.strictEqual(isWrongMatch, false);
});

// Test 2: Mime emoji helper mappings
test('MIME Helper Emoji Type Mapping', () => {
  function getFileEmoji(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '📷';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) return '📦';
    return '📄';
  }

  assert.strictEqual(getFileEmoji('image/jpeg'), '📷');
  assert.strictEqual(getFileEmoji('video/mp4'), '🎬');
  assert.strictEqual(getFileEmoji('audio/ogg'), '🎵');
  assert.strictEqual(getFileEmoji('application/pdf'), '📕');
  assert.strictEqual(getFileEmoji('application/zip'), '📦');
  assert.strictEqual(getFileEmoji('text/plain'), '📄');
  assert.strictEqual(getFileEmoji(''), '📄');
  assert.strictEqual(getFileEmoji(null), '📄');
});

// Test 3: Telegram message attachment parsers
test('Telegram Incoming Attachment Parser', () => {
  function parseAttachment(message) {
    let fileId, fileUniqueId, fileName, mimeType, fileSize;

    if (message.document) {
      const doc = message.document;
      fileId = doc.file_id;
      fileUniqueId = doc.file_unique_id;
      fileName = doc.file_name || 'doc';
      mimeType = doc.mime_type || 'application/octet-stream';
      fileSize = doc.file_size || 0;
    } else if (message.photo) {
      // Pick highest resolution photo size
      const photo = message.photo[message.photo.length - 1];
      fileId = photo.file_id;
      fileUniqueId = photo.file_unique_id;
      fileName = `photo_${Date.now()}.jpg`;
      mimeType = 'image/jpeg';
      fileSize = photo.file_size || 0;
    }

    const ext = fileName.includes('.') ? path.extname(fileName).toLowerCase().substring(1) : '';

    return { fileId, fileUniqueId, fileName, mimeType, fileSize, ext };
  }

  // Simulate Document
  const docPayload = {
    document: {
      file_id: 'file_id_doc123',
      file_unique_id: 'uniq_doc123',
      file_name: 'report.pdf',
      mime_type: 'application/pdf',
      file_size: 409600
    }
  };

  const docParsed = parseAttachment(docPayload);
  assert.strictEqual(docParsed.fileId, 'file_id_doc123');
  assert.strictEqual(docParsed.fileUniqueId, 'uniq_doc123');
  assert.strictEqual(docParsed.fileName, 'report.pdf');
  assert.strictEqual(docParsed.mimeType, 'application/pdf');
  assert.strictEqual(docParsed.fileSize, 409600);
  assert.strictEqual(docParsed.ext, 'pdf');

  // Simulate Photo
  const photoPayload = {
    photo: [
      { file_id: 'small_id', file_unique_id: 's_uniq', file_size: 100 },
      { file_id: 'large_id', file_unique_id: 'l_uniq', file_size: 50000 }
    ]
  };

  const photoParsed = parseAttachment(photoPayload);
  assert.strictEqual(photoParsed.fileId, 'large_id');
  assert.strictEqual(photoParsed.fileUniqueId, 'l_uniq');
  assert.strictEqual(photoParsed.mimeType, 'image/jpeg');
  assert.strictEqual(photoParsed.ext, 'jpg');
  assert.strictEqual(photoParsed.fileSize, 50000);
});

// Test 4: Express authentication check middleware triggers
test('Express Session Auth Middleware', () => {
  let isNextCalled = false;
  let statusResult = null;
  let jsonResult = null;

  const mockReq = {
    session: {}
  };
  const mockRes = {
    status(code) {
      statusResult = code;
      return this;
    },
    json(obj) {
      jsonResult = obj;
      return this;
    }
  };
  const mockNext = () => {
    isNextCalled = true;
  };

  function requireAuth(req, res, next) {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    next();
  }

  // 1. Session lacks user parameter (unauthorized check)
  requireAuth(mockReq, mockRes, mockNext);
  assert.strictEqual(isNextCalled, false);
  assert.strictEqual(statusResult, 401);
  assert.strictEqual(jsonResult.error, 'Unauthorized. Please log in.');

  // 2. Session has user parameters (authorized check)
  isNextCalled = false;
  statusResult = null;
  jsonResult = null;
  mockReq.session.user = { id: 'usr-1234-uuid', username: 'admin' };
  
  requireAuth(mockReq, mockRes, mockNext);
  assert.strictEqual(isNextCalled, true);
  assert.strictEqual(statusResult, null);
  assert.strictEqual(jsonResult, null);
});
