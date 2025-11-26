require('dotenv').config();
const db = require('./db');
const utils = require('./utils');

const osuApiInstance = utils.getOsuApiInstance();

async function main() {
    const osu = await osuApiInstance;
    const userIds = db.prepare(`SELECT id FROM users LIMIT 10`).all().map(u => u.id);
    const res = await osu.getUsers(userIds, true);
    for (const user of res) {
        for (const mode in user.statistics_rulesets) {
            const stats = user.statistics_rulesets[mode];
            console.log(`${user.username} has ${stats.play_count} plays in ${utils.rulesetKeyToName(mode, true)}`);
        }
    }
}
main();