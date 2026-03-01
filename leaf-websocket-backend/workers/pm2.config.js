/**
 * PM2 Configuration para Workers
 * 
 * Uso:
 *   pm2 start workers/pm2.config.js
 *   pm2 stop all
 *   pm2 restart all
 */

module.exports = {
    apps: [
        {
            name: 'listener-worker-1',
            script: './workers/listener-worker.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                WORKER_STREAM_NAME: 'ride_events',
                WORKER_GROUP_NAME: 'listener-workers',
                WORKER_BATCH_SIZE: 10,
                WORKER_BLOCK_TIME: 1000,
                WORKER_MAX_RETRIES: 3
            },
            error_file: './logs/worker-1-error.log',
            out_file: './logs/worker-1-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            watch: false
        },
        {
            name: 'listener-worker-2',
            script: './workers/listener-worker.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                WORKER_STREAM_NAME: 'ride_events',
                WORKER_GROUP_NAME: 'listener-workers',
                WORKER_BATCH_SIZE: 10,
                WORKER_BLOCK_TIME: 1000,
                WORKER_MAX_RETRIES: 3
            },
            error_file: './logs/worker-2-error.log',
            out_file: './logs/worker-2-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            watch: false
        },
        {
            name: 'listener-worker-3',
            script: './workers/listener-worker.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                WORKER_STREAM_NAME: 'ride_events',
                WORKER_GROUP_NAME: 'listener-workers',
                WORKER_BATCH_SIZE: 10,
                WORKER_BLOCK_TIME: 1000,
                WORKER_MAX_RETRIES: 3
            },
            error_file: './logs/worker-3-error.log',
            out_file: './logs/worker-3-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            watch: false
        }
    ]
};

