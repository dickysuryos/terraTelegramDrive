import { Telegraf } from 'telegraf';
import { getPool } from './db.js';
import { Readable } from 'stream';

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

  const bot = new Telegraf(token);

  // Handle deep link /start parameter
  bot.start(async (ctx) => {
    try {
      const payload = ctx.payload; // Extract deep link parameter (the file UUID)
      const chatId = ctx.chat.id;

      if (!payload) {
        return ctx.reply(
          `👋 *Welcome to the Terra Telegram Share Bot!*\n\n` +
          `This bot is used to download shared files from your Personal Drive.\n\n` +
          `To get a download link, open your Web Portal, open a file's metadata modal, and click "Copy Link" to share.`,
          { parse_mode: 'Markdown' }
        );
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
      const preparingMsg = await ctx.reply(`📥 Preparing file: <b>${escapeHtml(file.name)}</b>...`, { parse_mode: 'HTML' });

      try {
        // Fetch file path info using Main Bot's token
        const mainBotFileInfoUrl = `https://api.telegram.org/bot${mainBotToken}/getFile?file_id=${file.telegram_file_id}`;
        const infoRes = await fetch(mainBotFileInfoUrl);
        if (!infoRes.ok) {
          throw new Error(`Failed to fetch file info from Main Bot: ${infoRes.statusText}`);
        }

        const infoData = await infoRes.json();
        if (!infoData.ok) {
          throw new Error(`Main Bot getFile API returned error: ${infoData.description}`);
        }

        const filePath = infoData.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${mainBotToken}/${filePath}`;

        const fileRes = await fetch(downloadUrl);
        if (!fileRes.ok) {
          throw new Error(`Failed to download file stream from Telegram: ${fileRes.statusText}`);
        }

        // Convert Response body stream to node Readable stream
        const stream = Readable.fromWeb(fileRes.body);

        // Delete "Preparing..." message
        await ctx.telegram.deleteMessage(chatId, preparingMsg.message_id).catch(() => {});

        // Send the file document to the user
        await ctx.replyWithDocument(
          {
            source: stream,
            filename: file.name
          },
          {
            caption: `✨ <b>Shared File:</b> ${escapeHtml(file.name)}\n📦 <b>Size:</b> ${(file.size / (1024 * 1024)).toFixed(2)} MB`,
            parse_mode: 'HTML'
          }
        );

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
