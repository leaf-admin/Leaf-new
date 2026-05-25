module.exports = {
    apps: [
        {
            name: 'pricing-baseline-worker',
            script: './workers/pricing-baseline-worker.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                ENABLE_PRICING_BASELINE_WORKER: 'true',
                PRICING_BASELINE_WORKER_INTERVAL_MS: 300000,
                PRICING_BASELINE_WORKER_RUN_ON_BOOT: 'true',
                PRICING_BASELINE_MAX_CELLS: 250
            },
            error_file: './logs/pricing-baseline-worker-error.log',
            out_file: './logs/pricing-baseline-worker-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            watch: false
        }
    ]
};
