const { log } = require('./helpers/utils');
const osu = require('./helpers/osu');
const updaterHelpers = require('./helpers/updaterHelpers');
const dayjs = require('dayjs');

const runGlobalRecentsUpdate = async () => {
    await updaterHelpers.savePassesFromGlobalRecents();
    setTimeout(runGlobalRecentsUpdate, 1000 * 60);
};

const runBackupDatabase = async () => {
    await updaterHelpers.backupDatabase();
    setTimeout(runBackupDatabase, 1000 * 60);
};

const runSaveHistory = async () => {
    if (dayjs().hour() === 0) {
        log('Saving user history snapshot for the day...');
        updaterHelpers.snapshotCategoryStats();
        setTimeout(runSaveHistory, 1000 * 60 * 60);
    } else {
        setTimeout(runSaveHistory, 1000 * 60);
    }
};

const runImportQueue = async () => {
    await updaterHelpers.startQueuedImports();
    setTimeout(runImportQueue, 5000);
};

const runFetchNewMaps = async () => {
    await updaterHelpers.fetchNewMapData();
    setTimeout(runFetchNewMaps, 1000 * 60 * 5);
};

const runUpdateMapStatuses = async () => {
    await updaterHelpers.updateMapStatuses();
    updaterHelpers.updateAllUserCategoryStats();
    setTimeout(runUpdateMapStatuses, 1000 * 60 * 60 * 24);
};

async function main() {

    // Get osu API token
    // We await this before starting other processes to avoid
    // getting a bunch of tokens at once
    log('Authenticating with osu API...');
    await osu.getToken();

    // Start update processes
    log(`Starting update processes...`);
    runGlobalRecentsUpdate();
    runBackupDatabase();
    runImportQueue();
    runFetchNewMaps();
    runSaveHistory();
    setTimeout(runUpdateMapStatuses, 1000 * 60 * 60);

}
main();