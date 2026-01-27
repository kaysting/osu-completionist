const env = require('#env');
const { log } = require('#utils');
const osu = require('#lib/osu.js');
const dbWrite = require('#api/write.js');
const dayjs = require('dayjs');
const { io } = require('socket.io-client');
const utils = require('#utils');

const scoreBuffer = [];
const saveFromScoreBuffer = async () => {
    if (scoreBuffer.length > 0) {
        const scoresToSave = scoreBuffer.splice(0, 1000);
        utils.log(`Saving ${scoresToSave.length} buffered scores...`);
        await dbWrite.savePassesFromScores(scoresToSave);
    }
    setTimeout(saveFromScoreBuffer, 200);
};

const runUpdateGlobalRecents = async () => {
    await dbWrite.savePassesFromGlobalRecents();
    setTimeout(runUpdateGlobalRecents, 1000 * 60 * 2);
};

const runBackupDatabase = async () => {
    await dbWrite.backupDatabaseClean();
    setTimeout(runBackupDatabase, 1000 * 60);
};

const runSaveHistory = async () => {
    if (dayjs().hour() === 0) {
        log('Saving user history snapshot for the day...');
        dbWrite.snapshotCategoryStats();
        setTimeout(runSaveHistory, 1000 * 60 * 60);
    } else {
        setTimeout(runSaveHistory, 1000 * 60);
    }
};

const runImportQueue = async () => {
    await dbWrite.startQueuedImports();
    setTimeout(runImportQueue, 5000);
};

const runFetchNewMaps = async () => {
    await dbWrite.fetchNewMapData();
    setTimeout(runFetchNewMaps, 1000 * 60 * 5);
};

const runUpdateMapStatuses = async () => {
    await dbWrite.updateMapStatuses();
    dbWrite.updateAllUserCategoryStats();
    setTimeout(runUpdateMapStatuses, 1000 * 60 * 60 * 24);
};

const runAnalyticsSave = async () => {
    await dbWrite.saveAnalytics();
    setTimeout(runAnalyticsSave, 1000 * 60 * 15);
};

const runGenerateSitemap = async () => {
    await dbWrite.generateSitemap();
    setTimeout(runGenerateSitemap, 1000 * 60 * 60 * 24);
};

async function main() {

    // Get osu API token
    // We await this before starting other processes to avoid
    // getting a bunch of tokens at once
    log('Authenticating with osu API...');
    await osu.getToken();

    // Start update processes
    log(`Starting update processes...`);
    runBackupDatabase();
    runImportQueue();
    runFetchNewMaps();
    runSaveHistory();
    runAnalyticsSave();
    runGenerateSitemap();
    runUpdateGlobalRecents();
    saveFromScoreBuffer();

    // Delay this one so it only runs after the updater has been going for an hour
    setTimeout(runUpdateMapStatuses, 1000 * 60 * 60);

    // Connect to oSC websocket
    const socket = io(env.OSU_SCORE_CACHE_BASE_URL, {
        path: '/ws',
        transports: ['websocket'],
    });
    socket.on('connect', () => {
        socket.emit('subscribe', 'scores');
        utils.log(`Connected to and listening for new scores on osu! score cache websocket`);
    });

    // Listen for new scores
    socket.on('scores', scores => {
        scoreBuffer.push(...scores);
        utils.log(`Received ${scores.length} new scores from oSC`);
    });

}
main();