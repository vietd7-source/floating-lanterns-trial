import {
  TikTokLiveConnection,
  ControlEvent,
  WebcastEvent,
  UserOfflineError,
  SignAPIError,
} from 'tiktok-live-connector';
import { logger } from '../utils/logger.js';

const RECONNECT_DELAYS_MS = [5000, 10000, 20000, 40000, 60000];
const ROOM_OFFLINE_RETRY_MS = 60000;

// SignAPIError (and its subclasses: rate-limit, missing-tokens, premium-feature,
// authenticated-websocket) means the EulerStream sign server rejected us —
// retrying in a loop just burns quota faster and risks IP/account flags.
// UserOfflineError just means the room isn't live yet — wait and check again,
// it is not a quota/signing problem.
function classifyError(exception) {
  if (exception instanceof UserOfflineError) return 'room_offline';
  if (exception instanceof SignAPIError) return 'signing_quota';
  return 'transient';
}

export function connectToTikTok(username, handlers = {}) {
  const { onChat, onGift, onLike, onConnected, onDisconnected, onFatalError } = handlers;
  const signApiKey = process.env.EULERSTREAM_API_KEY;

  let reconnectAttempt = 0;
  let stopped = false;
  let connection = null;

  function scheduleReconnect(delayMs) {
    if (stopped) return;
    const delay = delayMs ?? RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttempt += 1;
    logger.warn(`TikTok connector: reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
    setTimeout(start, delay);
  }

  function handleException(exception, context) {
    const kind = classifyError(exception);
    if (kind === 'signing_quota') {
      logger.error(`TikTok connector: GATE RESULT = NO-GO — signing/quota error (${context}): ${exception.message}`);
      stopped = true;
      onFatalError && onFatalError(exception);
      return;
    }
    if (kind === 'room_offline') {
      logger.warn(`TikTok connector: room not live yet, checking again in ${ROOM_OFFLINE_RETRY_MS}ms`);
      scheduleReconnect(ROOM_OFFLINE_RETRY_MS);
      return;
    }
    logger.warn(`TikTok connector: transient error (${context}): ${exception.message}`);
    scheduleReconnect();
  }

  function attachListeners(conn) {
    conn.on(WebcastEvent.CHAT, (data) => onChat && onChat(data));
    conn.on(WebcastEvent.GIFT, (data) => onGift && onGift(data));
    conn.on(WebcastEvent.LIKE, (data) => onLike && onLike(data));

    conn.on(ControlEvent.DISCONNECTED, () => {
      logger.warn('TikTok connector: disconnected');
      onDisconnected && onDisconnected();
      if (!stopped) scheduleReconnect();
    });

    conn.on(ControlEvent.ERROR, ({ exception, info }) => {
      handleException(exception, info || 'runtime');
    });
  }

  function start() {
    if (stopped) return;
    logger.info(`TikTok connector: connecting to @${username}...`);
    connection = new TikTokLiveConnection(username, signApiKey ? { signApiKey } : undefined);
    attachListeners(connection);

    connection
      .connect()
      .then((state) => {
        reconnectAttempt = 0;
        logger.info(`TikTok connector: GATE RESULT = GO — connected, roomId=${state && state.roomId}`);
        onConnected && onConnected(state);
      })
      .catch((exception) => handleException(exception, 'connect'));
  }

  start();

  return {
    stop() {
      stopped = true;
      if (connection) {
        try {
          connection.disconnect();
        } catch {
          // already disconnected, ignore
        }
      }
    },
  };
}

export { classifyError };
