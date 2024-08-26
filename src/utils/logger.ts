import { createLogger, format, transports } from 'winston';
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';

import type { Logger } from 'winston';

const { NODE_ENV } = process.env;

export const { LOG_LEVEL = NODE_ENV === 'development' ? 'debug' : 'warn' } =
	process.env;

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  trace: 6
};

export const logger: Logger = createLogger({
	level: LOG_LEVEL,
  levels,
	transports: [
		new transports.Console({
			level: LOG_LEVEL,
			format: format.cli()
		}),
		new OpenTelemetryTransportV3({
			level: 'debug'
		})
	]
});
