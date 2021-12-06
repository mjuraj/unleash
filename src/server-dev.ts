import { start } from './lib/server-impl';
import { createConfig } from './lib/create-config';
import { LogLevel } from './lib/logger';

process.nextTick(async () => {
    try {
        await start(
            createConfig({
                db: {
                    user: 'unleash_user',
                    password: 'passord',
                    host: 'localhost',
                    port: 5432,
                    database: 'unleash3',
                    ssl: false,
                },
                server: {
                    enableRequestLogger: true,
                    baseUriPath: '',
                    // keepAliveTimeout: 1,
                    gracefulShutdownEnable: true,
                },
                logLevel: LogLevel.debug,
                enableOAS: true,
                versionCheck: {
                    enable: false,
                },
                experimental: {
                    metricsV2: {
                        enabled: true,
                    },
                },
            }),
        );
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            // eslint-disable-next-line no-console
            console.warn('Port in use. You might want to reload once more.');
        } else {
            // eslint-disable-next-line no-console
            console.error(error);
            process.exit();
        }
    }
}, 0);
