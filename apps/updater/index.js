const env = require('#env');
const { log } = require('#utils');
const osu = require('#lib/osu.js');
const writers = require('#api/write.js');
const dayjs = require('dayjs');
const { io } = require('socket.io-client');
const utils = require('#utils');

const scoreBuffer = [];
const saveFromScoreBuffer = async () => {
    if (scoreBuffer.length > 0) {
        const scoresToSave = scoreBuffer.splice(0, 1000);
        await writers.savePassesFromScores(scoresToSave);
    }
    setTimeout(saveFromScoreBuffer, 200);
};

const runUpdateGlobalRecents = async () => {
    await writers.savePassesFromGlobalRecents();
    setTimeout(runUpdateGlobalRecents, 1000 * 60 * 5);
};

const runBackupDatabase = async () => {
    await writers.backupDatabaseClean();
    setTimeout(runBackupDatabase, 1000 * 60);
};

const runSaveHistory = async () => {
    if (dayjs().hour() === 0) {
        log('Saving user history snapshot for the day...');
        writers.snapshotCategoryStats();
        setTimeout(runSaveHistory, 1000 * 60 * 60);
    } else {
        setTimeout(runSaveHistory, 1000 * 60);
    }
};

const runImportQueue = async () => {
    await writers.startQueuedImports();
    setTimeout(runImportQueue, 5000);
};

const runFetchNewMaps = async () => {
    await writers.fetchNewMapData();
    setTimeout(runFetchNewMaps, 1000 * 60 * 5);
};

let isFullStatusUpdateRunning = false;
const runUpdateAllMapStatuses = async () => {
    isFullStatusUpdateRunning = true;
    try {
        await writers.updateMapStatuses();
    } catch (error) {
        utils.logError(error);
    }
    isFullStatusUpdateRunning = false;
    setTimeout(runUpdateAllMapStatuses, 1000 * 60 * 60 * 24);
};

const runUpdateRecentMapStatuses = async () => {
    if (!isFullStatusUpdateRunning) {
        const after = Date.now() - 1000 * 60 * 60 * 24 * 7;
        await writers.updateMapStatuses(after);
    }
    setTimeout(runUpdateRecentMapStatuses, 1000 * 60 * 5);
};

const runAnalyticsSave = async () => {
    await writers.saveAnalytics();
    setTimeout(runAnalyticsSave, 1000 * 60 * 15);
};

const runGenerateSitemap = async () => {
    await writers.generateSitemap();
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
    runUpdateRecentMapStatuses();

    // Delay this one so it only runs after the updater has been going for an hour
    setTimeout(runUpdateAllMapStatuses, 1000 * 60 * 60);

    // Connect to oSC websocket
    const socket = io(env.OSU_SCORE_CACHE_BASE_URL, {
        path: '/ws',
        transports: ['websocket']
    });
    socket.on('connect', () => {
        socket.emit('subscribe', 'scores');
        utils.log(`Connected to and listening for new scores on osu! score cache websocket`);
    });

    // Listen for new scores
    socket.on('scores', scores => {
        scoreBuffer.push(...scores);
        //utils.log(`Received ${scores.length} new scores from oSC`);
    });
}
main();
