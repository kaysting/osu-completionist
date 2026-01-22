const globalWatch = [
    'lib', 'config', '.env'
];
module.exports = {
    apps: [
        {
            name: 'oc-web',
            script: 'npm',
            args: 'run webserver',
            cwd: './',
            watch: [
                ...globalWatch, 'apps/web/index.js', 'apps/web/routes'
            ],
            max_memory_restart: '1G'
        },
        {
            name: 'oc-updater',
            script: 'npm',
            args: 'run updater',
            cwd: './',
            watch: [
                ...globalWatch, 'apps/updater'
            ]
        }
    ]
};