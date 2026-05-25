module.exports = {
    apps: [
        {
            name: 'ride-health-monitor-worker',
            script: './workers/ride-health-monitor-worker.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                ENABLE_RIDE_HEALTH_MONITOR_WORKER: 'true',
                RIDE_HEALTH_MONITOR_INTERVAL_MS: 60000,
                RIDE_HEALTH_MONITOR_RUN_ON_BOOT: 'true',
                RIDE_HEALTH_REASSIGNMENT_STUCK_THRESHOLD_MS: 300000,
                RIDE_HEALTH_EARLY_REVIEW_WARNING_COUNT: 3,
                RIDE_HEALTH_EARLY_REVIEW_CRITICAL_COUNT: 6
            },
            error_file: './logs/ride-health-monitor-worker-error.log',
            out_file: './logs/ride-health-monitor-worker-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            watch: false
        }
    ]
};
