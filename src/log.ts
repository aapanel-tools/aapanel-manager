import pino from 'pino';
export const log = pino({level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'});
