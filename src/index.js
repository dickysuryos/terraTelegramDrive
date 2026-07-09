import { initDb } from './db.js';
import { createBot } from './bot.js';
import { createShareBot } from './shareBot.js';
import { createServer } from './server.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SHARE_BOT_TOKEN = process.env.TELEGRAM_SHARE_BOT_TOKEN;

async function bootstrap() {
  try {
    console.log('[STARTUP] Initializing MariaDB database connection pool and schema...');
    await initDb();

    console.log('[STARTUP] Starting Telegraf Bot instance...');
    const bot = createBot(BOT_TOKEN);
    
    // Launch polling in background
    bot.launch().then(() => {
      console.log('[STARTUP] Telegraf Bot successfully started polling updates.');
    }).catch(err => {
      console.error('[STARTUP] Failed to launch Telegram Bot polling:', err);
    });

    let shareBot = null;
    if (SHARE_BOT_TOKEN) {
      console.log('[STARTUP] Starting Telegraf Share Bot instance...');
      shareBot = createShareBot(SHARE_BOT_TOKEN, BOT_TOKEN);
      shareBot.launch().then(() => {
        console.log('[STARTUP] Telegraf Share Bot successfully started polling updates.');
      }).catch(err => {
        console.error('[STARTUP] Failed to launch Telegram Share Bot polling:', err);
      });
    } else {
      console.warn('[STARTUP] TELEGRAM_SHARE_BOT_TOKEN not configured. Share bot will not start.');
    }

    console.log('[STARTUP] Launching Express server framework...');
    const app = createServer(bot, shareBot);
    
    // TODO(security): Bind to 127.0.0.1 in production environments to restrict access to localhost
    app.listen(PORT, HOST, () => {
      console.log(`[STARTUP] Express Server running on http://${HOST}:${PORT}`);
    });

    // Handle process events for graceful cleanups
    process.once('SIGINT', () => {
      console.log('[SHUTDOWN] SIGINT received. Shutting down...');
      bot.stop('SIGINT');
      if (shareBot) shareBot.stop('SIGINT');
      process.exit(0);
    });
    process.once('SIGTERM', () => {
      console.log('[SHUTDOWN] SIGTERM received. Shutting down...');
      bot.stop('SIGTERM');
      if (shareBot) shareBot.stop('SIGTERM');
      process.exit(0);
    });

  } catch (error) {
    console.error('[STARTUP] Fatal exception during application startup:', error);
    process.exit(1);
  }
}

bootstrap();
