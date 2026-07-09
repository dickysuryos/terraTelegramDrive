import { Telegraf } from 'telegraf';
import { getPool } from './db.js';
import { Readable } from 'stream';
import fs from 'fs';

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function createShareBot(token, mainBotToken) {
  if (!token) {
    throw new Error('Telegram Share Bot Token is required.');
  }

  const botOptions = {};
  if (process.env.TELEGRAM_API_ROOT) {
    botOptions.telegram = {
      apiRoot: process.env.TELEGRAM_API_ROOT
    };
  }
  const bot = new Telegraf(token, botOptions);

  // Handle deep link /start parameter
  bot.start(async (ctx) => {
    try {
      const payload = ctx.payload; // Extract deep link parameter (the file UUID)
      const chatId = ctx.chat.id;

      if (!payload) {
        return; // No welcome message needed
      }

      // Payload is the file ID (UUID)
      const fileId = payload;
      const pool = getPool();

      // Query database for the file, ignoring trashed files
      const [files] = await pool.query(
        'SELECT * FROM files WHERE id = ? AND is_trashed = FALSE',
        [fileId]
      );

      if (files.length === 0) {
        return ctx.reply('❌ *File not found or has been deleted.*', { parse_mode: 'Markdown' });
      }

      const file = files[0];
      const preparingMsg = await ctx.reply(`📥 Downloading file: <b>${escapeHtml(file.name)}</b>. Please wait...`, { parse_mode: 'HTML' });

      try {
        const apiRoot = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
        // Fetch file path info using Main Bot's token
        const mainBotFileInfoUrl = `${apiRoot}/bot${mainBotToken}/getFile?file_id=${file.telegram_file_id}`;
        const infoRes = await fetch(mainBotFileInfoUrl);
        if (!infoRes.ok) {
          throw new Error(`Failed to fetch file info from Main Bot: ${infoRes.statusText}`);
        }

        const infoData = await infoRes.json();
        if (!infoData.ok) {
          throw new Error(`Main Bot getFile API returned error: ${infoData.description}`);
        }

        const filePath = infoData.result.file_path;

        // Delete "Preparing..." message
        await ctx.telegram.deleteMessage(chatId, preparingMsg.message_id).catch(() => {});

        // Determine if file is a video
        const isVideo = file.mime_type?.startsWith('video/') || 
                        ['mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv'].includes(file.extension?.toLowerCase());

        const extraOptions = {
          caption: `✨ <b>Shared File:</b> ${escapeHtml(file.name)}\n📦 <b>Size:</b> ${(file.size / (1024 * 1024)).toFixed(2)} MB`,
          parse_mode: 'HTML',
          protect_content: true
        };

        if (isVideo) {
          extraOptions.supports_streaming = true;
        }

        const replyMethod = isVideo ? 'replyWithVideo' : 'replyWithDocument';

        // If the file is stored locally (when using local Bot API with shared volumes)
        if (filePath && fs.existsSync(filePath)) {
          await ctx[replyMethod](
            {
              source: filePath,
              filename: file.name
            },
            extraOptions
          );
        } else {
          const downloadUrl = `${apiRoot}/file/bot${mainBotToken}/${filePath}`;
          const fileRes = await fetch(downloadUrl);
          if (!fileRes.ok) {
            throw new Error(`Failed to download file stream from Telegram: ${fileRes.statusText}`);
          }

          // Convert Response body stream to node Readable stream
          const stream = Readable.fromWeb(fileRes.body);

          // Send the file to the user
          await ctx[replyMethod](
            {
              source: stream,
              filename: file.name
            },
            extraOptions
          );
        }

      } catch (err) {
        console.error('Failed to prepare and send file via Share Bot:', err);
        await ctx.telegram.deleteMessage(chatId, preparingMsg.message_id).catch(() => {});
        await ctx.reply('❌ *Failed to download the file from Telegram Storage.*', { parse_mode: 'Markdown' });
      }

    } catch (error) {
      console.error('Error in Share Bot start handler:', error);
      ctx.reply('❌ *An unexpected error occurred.*', { parse_mode: 'Markdown' });
    }
  });

  return bot;
}
