const db = require('./db');
const osuApi = require('osu-api-v2-js');
const config = require('./config.json');

async function main() {
    const input = process.argv[2];
    if (!input) {
        console.error('Please provide a user name or ID as an argument.');
        process.exit(1);
    }
    const osu = await osuApi.API.createAsync(config.osu_client_id, config.osu_api_token);
    const user = await osu.getUser(input);
    if (!user) {
        console.error('User not found.');
        process.exit(1);
    }
    db.prepare(`INSERT OR REPLACE INTO user_update_tasks (user_id, time_queued) VALUES (?, ?)`).run(user.id, Date.now());
    console.log(`User ${user.username} (ID: ${user.id}) has been added to the update queue`);
}

main();