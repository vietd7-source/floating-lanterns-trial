import 'dotenv/config';
import express from 'express';
import { logger } from './utils/logger.js';
import { connectToTikTok } from './tiktok/connector.js';

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // Chromium connects locally only — never expose beyond localhost.
const ENABLE_MOCK = process.env.ENABLE_MOCK === 'true';

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, HOST, () => {
  logger.info(`Server listening on http://${HOST}:${PORT}`);
});

if (ENABLE_MOCK) {
  logger.info('ENABLE_MOCK=true — skipping real TikTok connection. Chat/gift/like simulation endpoints arrive in later steps.');
} else {
  const username = process.env.TIKTOK_USERNAME;
  if (!username) {
    logger.error('TIKTOK_USERNAME is not set in .env — cannot run the connector gate check.');
    process.exit(1);
  }
  if (!process.env.EULERSTREAM_API_KEY) {
    logger.warn('EULERSTREAM_API_KEY is not set — connection will likely fail or hit the shared free quota fast. Create a key at https://www.eulerstream.com');
  }

  connectToTikTok(username, {
    onConnected: (state) => logger.info(`Gate check: connected to room ${state && state.roomId}`),
    // Logging raw payloads here on purpose: v2's event shape is the raw
    // decoded protobuf message, not the simplified v1 shape — inspect these
    // logs during the Step 1 gate run to find the real field paths before
    // wiring up wishStore/giftClassifier in Step 2.
    onChat: (data) => logger.info(`chat: ${JSON.stringify(data)}`),
    onGift: (data) => logger.info(`gift: ${JSON.stringify(data)}`),
    onLike: (data) => logger.info(`like: ${JSON.stringify(data)}`),
    onDisconnected: () => logger.warn('Gate check: disconnected'),
    onFatalError: () => {
      logger.error('Gate check result: NO-GO — see error above. Fix signing/quota before continuing to Step 2.');
    },
  });
}
