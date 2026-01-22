module.exports = {
    apps: [
        {
            name: 'oc-web',
            script: 'npm',
            args: 'run webserver',
            cwd: './',
            watch: [
                'helpers', 'routes', 'webserver.js', '.env'
            ],
            max_memory_restart: '1G'
        },
        {
            name: 'oc-updater',
            script: 'npm',
            args: 'run updater',
            cwd: './',
            watch: [
                'helpers', 'updater.js', '.env'
            ]
        }
    ]
};