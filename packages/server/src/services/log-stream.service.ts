import { EventEmitter } from 'events';
import winston from 'winston';

const MAX_RECENT = 200;

class LogStreamService extends EventEmitter {
  private logger: winston.Logger;
  private recentLogs: object[] = [];

  constructor() {
    super();
    this.setMaxListeners(100);
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
      ],
    });
  }

  log(level: string, message: string, meta?: Record<string, unknown>) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };
    this.logger.log(level, message, meta);
    this.recentLogs.push(entry);
    if (this.recentLogs.length > MAX_RECENT) {
      this.recentLogs.shift();
    }
    this.emit('log', entry);
  }

  getRecentLogs(): object[] {
    return [...this.recentLogs];
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.log('error', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.log('debug', message, meta);
  }
}

export const logStream = new LogStreamService();
