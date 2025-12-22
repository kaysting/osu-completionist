const { log } = require('./utils');
const osu = require('./osu');
const updaterHelpers = require('./helpers/updaterHelpers');

const runGlobalRecentsUpdate = async () => {
    await updaterHelpers.savePassesFromGlobalRecents();
    setTimeout(runGlobalRecentsUpdate, 1000 * 60);
};

const runBackupDatabase = async () => {
    await updaterHelpers.backupDatabase();
    setTimeout(runBackupDatabase, 1000 * 60);
};

const runSaveHistory = async () => {
    await updaterHelpers.saveUserHistory();
    setTimeout(runSaveHistory, 1000);
};

const runImportQueue = async () => {
    await updaterHelpers.startQueuedImports();
    setTimeout(runImportQueue, 5000);
};

const runFetchMapData = async () => {
    await updaterHelpers.fetchNewMapData();
    setTimeout(runFetchMapData, 1000 * 60 * 60);
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
    runFetchMapData();
    runSaveHistory();

}
main();