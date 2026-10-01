// ============================================================
//  DISCORD RICH PRESENCE (RPC) CLIENT FOR TRACKER
//  Zero-dependency, pure Node.js Named Pipe IPC implementation
//  Developer: Sukku
// ============================================================

const net = require('net');
const EventEmitter = require('events');

// Fixed Discord Application ID for Tracker
const DEFAULT_CLIENT_ID = '1549145249987952752';

const OPCODES = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4
};

class DiscordRPC extends EventEmitter {
  constructor(clientId = DEFAULT_CLIENT_ID) {
    super();
    this.clientId = DEFAULT_CLIENT_ID;
    this.socket = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.currentActivity = null;
    this.lastActivityUpdate = 0;
    this.pendingActivity = null;
    this.hasPendingActivity = false; // tracks whether pendingActivity is intentionally queued
    this.throttleTimer = null;
    this.user = null;
    this.pipeIndex = 0;
    this.enabled = true;
  }

  getPipePath(index = 0) {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\discord-ipc-${index}`;
    }
    const env = process.env;
    const prefix = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
    return `${prefix}/discord-ipc-${index}`;
  }

  connect() {
    if (!this.enabled) return;
    if (this.isConnected || this.isConnecting) return;

    this.isConnecting = true;
    this._tryConnect(0);
  }

  _tryConnect(pipeIndex) {
    if (!this.enabled) {
      this.isConnecting = false;
      return;
    }

    if (pipeIndex >= 10) {
      this.isConnecting = false;
      this.isConnected = false;
      this.emit('disconnected', 'Discord client not running');
      this._scheduleReconnect(5000);
      return;
    }

    const pipePath = this.getPipePath(pipeIndex);
    let socket;
    let connectTimeout = null;

    try {
      socket = net.createConnection(pipePath);
    } catch {
      this._tryConnect(pipeIndex + 1);
      return;
    }

    const cleanup = () => {
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      socket.removeListener('connect', onConnect);
      socket.removeListener('error', onError);
    };

    const onConnect = () => {
      cleanup();
      this.socket = socket;
      this.pipeIndex = pipeIndex;
      this._setupSocket(socket);
      this._sendHandshake();
    };

    const onError = () => {
      cleanup();
      try { socket.destroy(); } catch {}
      this._tryConnect(pipeIndex + 1);
    };

    connectTimeout = setTimeout(() => {
      onError();
    }, 1200);

    socket.once('connect', onConnect);
    socket.once('error', onError);
  }

  _setupSocket(socket) {
    let incomingBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      incomingBuffer = Buffer.concat([incomingBuffer, chunk]);

      while (incomingBuffer.length >= 8) {
        const opcode = incomingBuffer.readInt32LE(0);
        const length = incomingBuffer.readInt32LE(4);

        if (incomingBuffer.length < 8 + length) {
          // Incomplete frame, wait for more data
          break;
        }

        const payloadBuffer = incomingBuffer.subarray(8, 8 + length);
        incomingBuffer = incomingBuffer.subarray(8 + length);

        this._handlePacket(opcode, payloadBuffer);
      }
    });

    socket.on('close', () => {
      this._handleDisconnect('Socket closed');
    });

    socket.on('error', (err) => {
      this._handleDisconnect(`Socket error: ${err.message}`);
    });
  }

  _sendHandshake() {
    const payload = JSON.stringify({
      v: 1,
      client_id: this.clientId
    });

    this._sendPacket(OPCODES.HANDSHAKE, payload);
  }

  _sendPacket(opcode, jsonPayload) {
    if (!this.socket || this.socket.destroyed) return;

    try {
      const payloadBuf = Buffer.from(jsonPayload, 'utf8');
      const headerBuf = Buffer.alloc(8);
      headerBuf.writeInt32LE(opcode, 0);
      headerBuf.writeInt32LE(payloadBuf.length, 4);

      const packet = Buffer.concat([headerBuf, payloadBuf]);
      this.socket.write(packet);
    } catch (err) {
      console.warn('DiscordRPC write error:', err.message);
    }
  }

  _handlePacket(opcode, buffer) {
    try {
      const data = JSON.parse(buffer.toString('utf8'));

      if (opcode === OPCODES.FRAME) {
        if (data.cmd === 'DISPATCH') {
          if (data.evt === 'READY') {
            this.isConnected = true;
            this.isConnecting = false;
            this.user = data.data.user || null;
            this.emit('ready', {
              user: this.user,
              config: data.data.config
            });

            if (this.hasPendingActivity) {
              const act = this.pendingActivity;
              this.pendingActivity = null;
              this.hasPendingActivity = false;
              this.setActivity(act);
            }
          }
        } else if (data.cmd === 'SET_ACTIVITY') {
          if (data.evt === 'ERROR') {
            this.emit('rpc-error', data.data);
          } else {
            this.emit('activity-set', data.data);
          }
        }
      } else if (opcode === OPCODES.PING) {
        this._sendPacket(OPCODES.PONG, JSON.stringify(data));
      } else if (opcode === OPCODES.CLOSE) {
        const msg = data.message || (data.code ? `Error ${data.code}` : 'Discord closed connection');
        this.emit('rpc-error', { code: data.code, message: msg });
        this._handleDisconnect(`Discord error: ${msg}`);
      }
    } catch (e) {
      console.warn('Error parsing Discord packet:', e.message);
    }
  }

  _handleDisconnect(reason) {
    this.isConnected = false;
    this.isConnecting = false;
    this.user = null;

    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }

    this.emit('disconnected', reason);

    if (this.enabled) {
      this._scheduleReconnect(5000);
    }
  }

  _scheduleReconnect(delayMs) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delayMs);
  }

  setActivity(activity) {
    if (!this.enabled) return;

    const now = Date.now();
    const minInterval = 1500; // Throttle to Discord rate limits (1.5s)

    if (!this.isConnected) {
      this.pendingActivity = activity;
      this.hasPendingActivity = true;
      this.connect();
      return;
    }

    if (now - this.lastActivityUpdate < minInterval) {
      this.pendingActivity = activity;
      this.hasPendingActivity = true;
      if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          if (this.hasPendingActivity) {
            const next = this.pendingActivity;
            this.pendingActivity = null;
            this.hasPendingActivity = false;
            this.setActivity(next);
          }
        }, minInterval - (now - this.lastActivityUpdate));
      }
      return;
    }

    this.lastActivityUpdate = now;
    this.currentActivity = activity;

    const payload = JSON.stringify({
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity: activity || null
      },
      nonce: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    });

    this._sendPacket(OPCODES.FRAME, payload);
  }

  clearActivity() {
    this.setActivity(null);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.throttleTimer) clearTimeout(this.throttleTimer);

    if (this.socket) {
      try {
        this.socket.end();
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.user = null;
    this.emit('disconnected', 'Explicitly disconnected');
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.enabled) {
      this.connect();
    } else {
      this.clearActivity();
      this.disconnect();
    }
  }
}

module.exports = {
  DiscordRPC,
  DEFAULT_CLIENT_ID
};
