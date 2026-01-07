const fs = require('fs');
const crypto = require('crypto');
const cp = require('child_process');
const path = require('path');
const SqlDumpParser = require('./helpers/SqlDumpParser');
const db = require('./helpers/db');
const updateHelpers = require('./helpers/updaterHelpers');
const utils = require('./helpers/utils');

const importBeatmapsets = async () => {
    const dumpFolder = process.argv[3];
    if (!dumpFolder || !fs.existsSync(dumpFolder)) {
        console.error('Please provide the path to a fully extracted data.ppy.sh dump as the last argument.');
        process.exit(1);
    }
    console.time('Import beatmaps from dump');
    console.log('Importing unsaved beatmapsets...');
    const storedMapsetIds = db.prepare(`SELECT id FROM beatmapsets`).all().map(row => row.id);
    const beatmapsetsParser = new SqlDumpParser({ tableName: 'osu_beatmapsets' });
    const stream = fs.createReadStream(`${dumpFolder}/osu_beatmapsets.sql`);
    stream.pipe(beatmapsetsParser);
    let newMapsetCount = 0;
    // Loop through dump entries
    for await (const row of beatmapsetsParser) {
        const mapsetId = row.beatmapset_id;
        // Skip if already stored
        if (storedMapsetIds.includes(mapsetId)) continue;
        await updateHelpers.saveMapset(mapsetId);
        newMapsetCount++;
    }
    console.timeEnd('Import beatmaps from dump');

    console.log(`Importing incomplete beatmaps...`);
    console.time('Import incomplete beatmaps');
    // Save any other maps that we don't have or that are missing data
    const rows = [
        // beatmaps missing cs
        ...db.prepare(
            `SELECT DISTINCT mapset_id FROM beatmaps WHERE cs IS NULL`
        ).all(),
        // beatmaps users have passed but we don't have data for
        ...db.prepare(
            `SELECT DISTINCT mapset_id FROM user_passes
            WHERE mapset_id NOT IN (SELECT id FROM beatmapsets)`
        ).all(),
        // mapsets with no maps
        ...db.prepare(
            `SELECT id AS mapset_id FROM beatmapsets
            WHERE id NOT IN (SELECT DISTINCT mapset_id FROM beatmaps)`
        ).all()
    ];
    for (const row of rows) {
        await updateHelpers.saveMapset(row.mapset_id, false);
        newMapsetCount++;
    }
    console.timeEnd('Import incomplete beatmaps');

    // Log import results
    console.log(`Imported ${newMapsetCount} beatmapsets`);

    // Repopulate the search table
    const insertIntoIndex = db.prepare(`
        INSERT INTO beatmaps_search (title, artist, name, map_id, mode)
        VALUES (?, ?, ?, ?, ?)
    `);
    const rebuildSearchIndex = db.transaction(() => {
        // Get all maps
        const maps = db.prepare(`
            SELECT b.id AS map_id, b.mode, b.name, bs.title, bs.artist
            FROM beatmaps b
            JOIN beatmapsets bs ON b.mapset_id = bs.id
        `).all();
        console.log(`Rebuilding beatmap search index with ${maps.length} entries`);
        // Clear index
        db.prepare(`DELETE FROM beatmaps_search`).run();
        // Insert missing maps into search index
        for (const row of maps) {
            insertIntoIndex.run(row.title, row.artist, row.name, row.map_id, row.mode);
        }
    });

    console.time("FTS rebuild");
    const count = rebuildSearchIndex();
    console.timeEnd("FTS rebuild");

    // Optimize
    if (count > 1000) {
        console.time(`Optimize FTS`);
        console.log("Optimizing FTS index...");
        db.prepare("INSERT INTO beatmaps_search(beatmaps_search) VALUES('optimize')").run();
        console.timeEnd(`Optimize FTS`);
    }

    // Recalculate beatmap stats
    console.log('Updating beatmap stats...');
    console.time('Update beatmap stats');
    updateHelpers.updateBeatmapStats();
    console.timeEnd('Update beatmap stats');

};

const updateCategoryStats = () => {
    console.time('Update category stats');
    updateHelpers.updateAllUserCategoryStats();
    console.timeEnd('Update category stats');
};

const getSecret = () => {
    const secret = utils.generateSecretKey(32);
    console.log(`Here's a cryptographically securely random secret:\n${secret}`);
};

const dumpSchema = () => {
    const dbPath = path.resolve(process.env.DB_PATH || './storage.db');
    const schemaPath = path.resolve(__dirname, './schema.sql');
    cp.execSync(`sqlite3 "${dbPath}" .schema > "${schemaPath}"`);
};

switch (process.argv[2]) {
    case 'importBeatmaps':
        importBeatmapsets();
        break;
    case 'updateCatStats':
        updateCategoryStats();
        break;
    case 'getSecret':
        getSecret();
        break;
    case 'dumpSchema':
        dumpSchema();
        break;
}