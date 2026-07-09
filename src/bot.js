import { Telegraf } from 'telegraf';
import path from 'path';
import crypto from 'crypto';
import { getPool } from './db.js';

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([*_`\[])/g, '\\$1');
}

export function createBot(token) {
  if (!token) {
    throw new Error('Telegram Bot Token is required.');
  }

  const bot = new Telegraf(token);

  // Helper to get active user by chat ID
  async function getUserByChatId(chatId) {
    const pool = getPool();
    const [users] = await pool.query('SELECT * FROM users WHERE telegram_chat_id = ?', [chatId]);
    return users.length > 0 ? users[0] : null;
  }

  // Command /start (handles deep linking start parameter e.g., /start link_TOKEN)
  bot.start(async (ctx) => {
    try {
      const payload = ctx.payload; // Extracts start token
      const chatId = ctx.chat.id;
      const pool = getPool();

      if (payload && payload.startsWith('link_')) {
        const token = payload.substring(5); // strip link_

        // Find user with active token and check expiration (10 min lifetime)
        const [users] = await pool.query(
          'SELECT * FROM users WHERE telegram_link_token = ? AND telegram_link_expires > NOW()',
          [token]
        );

        if (users.length > 0) {
          const user = users[0];
          // Clear link token and link chat
          await pool.query(
            'UPDATE users SET telegram_chat_id = ?, telegram_link_token = NULL, telegram_link_expires = NULL WHERE id = ?',
            [chatId, user.id]
          );
          return await ctx.reply(
            `✅ *Account Linked Successfully!*\n\n` +
            `You are now connected to the drive account *${user.username}*.\n` +
            `Any files you send or forward here will automatically appear on your Web Portal dashboard.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          return await ctx.reply(
            '❌ *Link Token Invalid or Expired*\n\n' +
            'Please generate a new linking link from your Profile / Settings on the Web dashboard.'
          );
        }
      }

      const user = await getUserByChatId(chatId);
      if (user) {
        return await ctx.reply(
          `Welcome back to your Personal Drive!\n\n` +
          `Linked Account: *${user.username}*\n\n` +
          `• Send or forward files to save them.\n` +
          `• Use /storage to see space utilization.\n` +
          `• Use /files to browse recent files.`,
          { parse_mode: 'Markdown' }
        );
      }

      return await ctx.reply(
        'Welcome to your Personal Telegram Drive bot!\n\n' +
        'To connect this bot to your drive:\n' +
        '1. Log in to the Drive Web Portal\n' +
        '2. Click "Link Telegram" in Settings\n' +
        '3. Follow the link to link your account.'
      );
    } catch (error) {
      console.error('Error in /start command:', error);
      return ctx.reply('An error occurred during account verification.');
    }
  });

  // Command /upload
  bot.command('upload', (ctx) => {
    ctx.reply(
      '📥 *How to upload files:*\n\n' +
      'Just drag-and-drop or send files directly to this chat window. You can also forward files, images, videos, or documents from other chats/channels to this bot to save them instantly.',
      { parse_mode: 'Markdown' }
    );
  });

  // Command /files
  bot.command('files', async (ctx) => {
    try {
      const user = await getUserByChatId(ctx.chat.id);
      if (!user) return ctx.reply('⚠️ Account not linked. Please link your account via Web UI.');

      const pool = getPool();
      const [files] = await pool.query(
        'SELECT name, size, folder FROM files WHERE user_id = ? AND is_trashed = FALSE ORDER BY created_at DESC LIMIT 10',
        [user.id]
      );

      if (files.length === 0) {
        return ctx.reply('Your Personal Drive is currently empty.');
      }

      let response = '🗂 *Recent Files (up to 10):*\n\n';
      files.forEach((f, index) => {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        response += `${index + 1}. 📄 *${escapeMarkdown(f.name)}* (${sizeMb} MB)\n   Folder: \`${escapeMarkdown(f.folder)}\`\n`;
      });

      return ctx.reply(response, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error listing files:', error);
      ctx.reply('Failed to fetch file list.');
    }
  });

  // Command /search <query>
  bot.command('search', async (ctx) => {
    try {
      const user = await getUserByChatId(ctx.chat.id);
      if (!user) return ctx.reply('⚠️ Account not linked.');

      const query = ctx.message.text.substring(8).trim();
      if (!query) {
        return ctx.reply('Usage: /search <keyword or tag>');
      }

      const pool = getPool();
      // Search file name or tags
      const [files] = await pool.query(
        `SELECT name, size, folder FROM files 
         WHERE user_id = ? AND is_trashed = FALSE 
           AND (name LIKE ? OR JSON_CONTAINS(tags, JSON_QUOTE(?))) 
         ORDER BY created_at DESC LIMIT 10`,
        [user.id, `%${query}%`, query]
      );

      if (files.length === 0) {
        return ctx.reply(`No active files found matching "${query}".`);
      }

      let response = `🔍 *Search results for "${query}":*\n\n`;
      files.forEach((f, idx) => {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        response += `${idx + 1}. 📄 *${escapeMarkdown(f.name)}* (${sizeMb} MB)\n   Folder: \`${escapeMarkdown(f.folder)}\`\n`;
      });

      return ctx.reply(response, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in search bot:', error);
      ctx.reply('Failed to execute search query.');
    }
  });

  // Command /folder <folder_path>
  bot.command('folder', async (ctx) => {
    try {
      const user = await getUserByChatId(ctx.chat.id);
      if (!user) return ctx.reply('⚠️ Account not linked.');

      const arg = ctx.message.text.substring(8).trim();
      const pool = getPool();

      // Case 1: Reply to file message to move folder
      if (ctx.message.reply_to_message) {
        if (!arg) return ctx.reply('Usage: Reply to a file with `/folder <folder_path>` to move it.');
        const replyMsgId = ctx.message.reply_to_message.message_id;

        // Resolve folder path nicely
        let folderPath = arg;
        if (!folderPath.startsWith('/')) folderPath = '/' + folderPath;
        if (folderPath.endsWith('/') && folderPath.length > 1) folderPath = folderPath.slice(0, -1);

        const [files] = await pool.query(
          'SELECT * FROM files WHERE telegram_message_id = ? AND telegram_chat_id = ? AND user_id = ?',
          [replyMsgId, ctx.chat.id, user.id]
        );

        if (files.length === 0) {
          return ctx.reply('❌ No matching file metadata found in your drive.');
        }

        const file = files[0];
        await pool.query('UPDATE files SET folder = ? WHERE id = ?', [folderPath, file.id]);
        return ctx.reply(`📁 Moved *${escapeMarkdown(file.name)}* to \`${escapeMarkdown(folderPath)}\``, { parse_mode: 'Markdown' });
      }

      // Case 2: List files in a folder, or list folders
      if (!arg) {
        const [folders] = await pool.query(
          'SELECT DISTINCT folder FROM files WHERE user_id = ? AND is_trashed = FALSE',
          [user.id]
        );

        if (folders.length === 0) return ctx.reply('No folders created yet.');

        let res = '📁 *Folders in Drive:*\n\n';
        folders.forEach(f => {
          res += `• \`${escapeMarkdown(f.folder)}\`\n`;
        });
        res += '\nUse `/folder <path>` to view files inside.';
        return ctx.reply(res, { parse_mode: 'Markdown' });
      }

      let folderQuery = arg;
      if (!folderQuery.startsWith('/')) folderQuery = '/' + folderQuery;
      if (folderQuery.endsWith('/') && folderQuery.length > 1) folderQuery = folderQuery.slice(0, -1);

      const [files] = await pool.query(
        'SELECT name, size FROM files WHERE user_id = ? AND folder = ? AND is_trashed = FALSE LIMIT 10',
        [user.id, folderQuery]
      );

      if (files.length === 0) {
        return ctx.reply(`No active files found in folder \`${folderQuery}\`.`);
      }

      let res = `📁 *Files in folder \`${escapeMarkdown(folderQuery)}\`:*\n\n`;
      files.forEach((f, idx) => {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        res += `${idx + 1}. 📄 *${escapeMarkdown(f.name)}* (${sizeMb} MB)\n`;
      });
      return ctx.reply(res, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error handling folder command:', error);
      ctx.reply('Failed to query folder details.');
    }
  });

  // Command /tag <tag1> <tag2>
  bot.command('tag', async (ctx) => {
    try {
      const user = await getUserByChatId(ctx.chat.id);
      if (!user) return ctx.reply('⚠️ Account not linked.');

      const arg = ctx.message.text.substring(5).trim();
      const pool = getPool();

      // Case 1: Reply to file message
      if (ctx.message.reply_to_message) {
        const replyMsgId = ctx.message.reply_to_message.message_id;
        const [files] = await pool.query(
          'SELECT * FROM files WHERE telegram_message_id = ? AND telegram_chat_id = ? AND user_id = ?',
          [replyMsgId, ctx.chat.id, user.id]
        );

        if (files.length === 0) {
          return ctx.reply('❌ No matching file metadata found in your drive.');
        }

        const file = files[0];
        const tags = arg ? arg.split(/[\s,]+/).filter(t => t.trim().length > 0) : [];

        await pool.query('UPDATE files SET tags = ? WHERE id = ?', [JSON.stringify(tags), file.id]);
        return ctx.reply(
          `🏷 *Tags updated for ${escapeMarkdown(file.name)}:*\n` +
          `${tags.length > 0 ? tags.map(t => `#${t}`).join(' ') : 'None'}`,
          { parse_mode: 'Markdown' }
        );
      }

      // Case 2: List files with tag
      if (!arg) {
        return ctx.reply('Usage: Reply to a file with `/tag <tag1> <tag2>` to update tags.');
      }

      const [files] = await pool.query(
        `SELECT name, size, folder FROM files 
         WHERE user_id = ? AND is_trashed = FALSE AND JSON_CONTAINS(tags, JSON_QUOTE(?))`,
        [user.id, arg]
      );

      if (files.length === 0) {
        return ctx.reply(`No files tagged with #${arg}.`);
      }

      let res = `🏷 *Files tagged with #${escapeMarkdown(arg)}:*\n\n`;
      files.forEach((f, idx) => {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        res += `${idx + 1}. 📄 *${escapeMarkdown(f.name)}* (${sizeMb} MB) in \`${escapeMarkdown(f.folder)}\`\n`;
      });
      return ctx.reply(res, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in /tag command:', error);
      ctx.reply('Failed to update/query file tags.');
    }
  });

  // Command /delete
  bot.command('delete', async (ctx) => {
    try {
      const user = await getUserByChatId(ctx.chat.id);
      if (!user) return ctx.reply('⚠️ Account not linked.');

      if (!ctx.message.reply_to_message) {
        return ctx.reply('Usage: Reply to a bot file message with `/delete` to remove it permanently.');
      }

      const replyMsgId = ctx.message.reply_to_message.message_id;
      const pool = getPool();
      const [files] = await pool.query(
        'SELECT * FROM files WHERE telegram_message_id = ? AND telegram_chat_id = ? AND user_id = ?',
        [replyMsgId, ctx.chat.id, user.id]
      );

      if (files.length === 0) {
        return ctx.reply('❌ Could not find drive file record associated with this message.');
      }

      const file = files[0];
      await pool.query('DELETE FROM files WHERE id = ?', [file.id]);
      return ctx.reply(`🗑 *${escapeMarkdown(file.name)}* was permanently deleted from your drive.`, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error deleting file:', error);
      ctx.reply('Failed to delete file.');
    }
  });

  // Command /trash
  bot.command('trash', async (ctx) => {
    try {
      const user = await getUserByChatId(ctx.chat.id);
      if (!user) return ctx.reply('⚠️ Account not linked.');

      const pool = getPool();

      // Case 1: Reply to file to move to trash
      if (ctx.message.reply_to_message) {
        const replyMsgId = ctx.message.reply_to_message.message_id;
        const [files] = await pool.query(
          'SELECT * FROM files WHERE telegram_message_id = ? AND telegram_chat_id = ? AND user_id = ?',
          [replyMsgId, ctx.chat.id, user.id]
        );

        if (files.length === 0) {
          return ctx.reply('❌ Could not find drive file record associated with this message.');
        }

        const file = files[0];
        await pool.query('UPDATE files SET is_trashed = TRUE WHERE id = ?', [file.id]);
        return ctx.reply(`🗑 Trashed *${escapeMarkdown(file.name)}*. You can restore it or permanently delete it from the Web UI.`, { parse_mode: 'Markdown' });
      }

      // Case 2: List trash contents
      const [trashed] = await pool.query(
        'SELECT name, size FROM files WHERE user_id = ? AND is_trashed = TRUE LIMIT 10',
        [user.id]
      );

      if (trashed.length === 0) {
        return ctx.reply('Your trash folder is currently empty.');
      }

      let res = '🗑 *Trashed Files (up to 10):*\n\n';
      trashed.forEach((f, idx) => {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        res += `${idx + 1}. 📄 *${f.name}* (${sizeMb} MB)\n`;
      });
      return ctx.reply(res, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error handling trash bot command:', error);
      ctx.reply('Failed to display/trash file.');
    }
  });

  // Command /info
  bot.command('info', async (ctx) => {
    try {
      const user = await getUserByChatId(ctx.chat.id);
      if (!user) return ctx.reply('⚠️ Account not linked.');

      if (!ctx.message.reply_to_message) {
        return ctx.reply('Usage: Reply to a file message with `/info` to see detailed metadata.');
      }

      const replyMsgId = ctx.message.reply_to_message.message_id;
      const pool = getPool();
      const [files] = await pool.query(
        'SELECT * FROM files WHERE telegram_message_id = ? AND telegram_chat_id = ? AND user_id = ?',
        [replyMsgId, ctx.chat.id, user.id]
      );

      if (files.length === 0) {
        return ctx.reply('❌ No file details found for this message.');
      }

      const file = files[0];
      const sizeStr = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
      const uploadDate = file.created_at.toISOString().split('T')[0];
      
      let tagsArr = [];
      try {
        tagsArr = Array.isArray(file.tags) ? file.tags : JSON.parse(file.tags || '[]');
      } catch (e) {
        // Fallback
      }
      const tagsStr = tagsArr.length > 0 ? tagsArr.map(t => `#${t}`).join(' ') : 'None';
      
      let sourceStr = 'Web Upload';
      if (file.source === 'telegram') sourceStr = 'Telegram Bot';
      else if (file.source === 'api') sourceStr = 'API Upload';
      else if (file.source === 'import') sourceStr = 'URL Import';

      return ctx.reply(
        `📄 *${escapeMarkdown(file.name)}*\n\n` +
        `*Size:*\n${sizeStr}\n\n` +
        `*Uploaded:*\n${uploadDate}\n\n` +
        `*Source:*\n${sourceStr}\n\n` +
        `*Folder:*\n\`${escapeMarkdown(file.folder)}\`\n\n` +
        `*SHA256:*\n\`${file.sha256.substring(0, 16)}...\`\n\n` +
        `*Telegram ID:*\n\`${file.telegram_file_id.substring(0, 16)}...\``,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Error fetching file info:', error);
      ctx.reply('Failed to display file metadata.');
    }
  });

  // Command /storage
  bot.command('storage', async (ctx) => {
    try {
      const user = await getUserByChatId(ctx.chat.id);
      if (!user) return ctx.reply('⚠️ Account not linked.');

      const pool = getPool();
      const [[{ total_files }]] = await pool.query('SELECT COUNT(*) as total_files FROM files WHERE user_id = ? AND is_trashed = FALSE', [user.id]);
      const [[{ total_size }]] = await pool.query('SELECT COALESCE(SUM(size), 0) as total_size FROM files WHERE user_id = ? AND is_trashed = FALSE', [user.id]);
      const [[{ trashed_files }]] = await pool.query('SELECT COUNT(*) as trashed_files FROM files WHERE user_id = ? AND is_trashed = TRUE', [user.id]);

      const sizeMb = (total_size / (1024 * 1024)).toFixed(1);

      return ctx.reply(
        `📊 *Storage Stats:*\n\n` +
        `📁 Active Files: *${total_files}*\n` +
        `📦 Storage Used: *${sizeMb} MB*\n` +
        `🗑 Trashed Files: *${trashed_files}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Error querying storage:', error);
      ctx.reply('Failed to fetch storage metrics.');
    }
  });

  // Handle incoming file attachments (Method 2 and 3)
  bot.on(['document', 'photo', 'audio', 'video', 'voice'], async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const user = await getUserByChatId(chatId);
      if (!user) {
        return ctx.reply('⚠️ Your account is not linked yet. Log in to the Web dashboard and link your Telegram account.');
      }

      let fileId, fileUniqueId, fileName, mimeType, fileSize;

      if (ctx.message.document) {
        const doc = ctx.message.document;
        fileId = doc.file_id;
        fileUniqueId = doc.file_unique_id;
        fileName = doc.file_name || `doc_${Date.now()}`;
        mimeType = doc.mime_type || 'application/octet-stream';
        fileSize = doc.file_size || 0;
      } else if (ctx.message.photo) {
        // Use largest photo version
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = photo.file_id;
        fileUniqueId = photo.file_unique_id;
        fileName = `photo_${Date.now()}.jpg`;
        mimeType = 'image/jpeg';
        fileSize = photo.file_size || 0;
      } else if (ctx.message.audio) {
        const aud = ctx.message.audio;
        fileId = aud.file_id;
        fileUniqueId = aud.file_unique_id;
        fileName = aud.file_name || `audio_${Date.now()}.mp3`;
        mimeType = aud.mime_type || 'audio/mpeg';
        fileSize = aud.file_size || 0;
      } else if (ctx.message.video) {
        const vid = ctx.message.video;
        fileId = vid.file_id;
        fileUniqueId = vid.file_unique_id;
        fileName = vid.file_name || `video_${Date.now()}.mp4`;
        mimeType = vid.mime_type || 'video/mp4';
        fileSize = vid.file_size || 0;
      } else if (ctx.message.voice) {
        const voice = ctx.message.voice;
        fileId = voice.file_id;
        fileUniqueId = voice.file_unique_id;
        fileName = `voice_${Date.now()}.ogg`;
        mimeType = voice.mime_type || 'audio/ogg';
        fileSize = voice.file_size || 0;
      }

      // Send feedback message to user
      const statusMsg = await ctx.reply('📤 Uploading...');

      // Calculate file extension
      const fileExt = fileName.includes('.') ? path.extname(fileName).toLowerCase().substring(1) : '';

      // Calculate SHA256 of the Telegram attachment
      let sha256Hash = '';
      try {
        if (fileSize > 0 && fileSize <= 20 * 1024 * 1024) { // Download only if <= 20MB
          const fileInfo = await ctx.telegram.getFile(fileId);
          const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
          const response = await fetch(fileUrl);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            sha256Hash = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
          } else {
            throw new Error(`Failed to download: ${response.statusText}`);
          }
        } else {
          // Synthetic stable hash for large files
          sha256Hash = crypto.createHash('sha256').update(fileUniqueId).digest('hex');
        }
      } catch (err) {
        console.warn('Error downloading for SHA256, using unique ID fallback hash:', err.message);
        sha256Hash = crypto.createHash('sha256').update(fileUniqueId).digest('hex');
      }

      const fileRecordId = crypto.randomUUID();
      const folder = '/';
      const pool = getPool();

      // Insert file metadata into DB
      await pool.query(
        `INSERT INTO files (id, name, extension, mime_type, size, sha256, telegram_file_id, telegram_unique_id, telegram_message_id, telegram_chat_id, source, folder, tags, user_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fileRecordId,
          fileName,
          fileExt,
          mimeType,
          fileSize,
          sha256Hash,
          fileId,
          fileUniqueId,
          ctx.message.message_id,
          chatId,
          'telegram',
          folder,
          JSON.stringify([]),
          user.id
        ]
      );

      const sizeStr = (fileSize / (1024 * 1024)).toFixed(1) + ' MB';
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        null,
        `✅ Saved successfully\n\n` +
        `📁 Folder\n${folder}\n\n` +
        `📄 Name\n${fileName}\n\n` +
        `📦 Size\n${sizeStr}\n\n` +
        `🏷 Tags\nNone\n\n` +
        `Use /tag to add tags (reply to this message).`
      );

    } catch (error) {
      console.error('Error saving attachment:', error);
      ctx.reply('❌ Failed to process and save file.');
    }
  });

  return bot;
}
