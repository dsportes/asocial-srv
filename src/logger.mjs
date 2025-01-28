import { env } from 'process'
import winston from 'winston'
import { config, GAELoggingWinston } from './config.mjs'

// Setup Logging ***********************************************
export function setLogger () {

  if (GAELoggingWinston && config.run.mode === 'gae') {
    // Imports the Google Cloud client library for Winston
    const loggingWinston = GAELoggingWinston
    // Logs will be written to: "projects/YOUR_PROJECT_ID/logs/winston_log"
    return winston.createLogger({
      level: 'info',
      transports: [
        new winston.transports.Console(),
        // Add Cloud Logging
        loggingWinston,
      ],
    })
  }

  // const { format, transports } = require('winston')
  // const { combine, timestamp, label, printf } = format
  const fne = config.pathlogs + '/error.log'
  const fnc = config.pathlogs + '/combined.log'
  const myFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`
  })
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), myFormat),
    // defaultMeta: { service: 'user-service' },
    transports: [
      // - Write all logs with importance level of `error` or less to `error.log`
      // - Write all logs with importance level of `info` or less to `combined.log`
      new winston.transports.File({ filename: fne, level: 'error' }),
      new winston.transports.File({ filename: fnc }),
    ],
  })
  // If we're not in production then log to the `console
  if (env.NODE_ENV !== 'production')
    logger.add(new winston.transports.Console())
  return logger
}