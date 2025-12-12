// This script can be used to import beatmaps from a data.ppy.sh dump
// This ensures that DMCA'd beatmaps are included in the database,
// which otherwise can't be fetched by the Search Beatmapset API endpoint

const fs = require('fs');
const SqlDumpParser = require('./helpers/mysql-stream-parser');
const db = require('./db');
const osu = require('./osu');

const dumpFolder = process.argv[2];

const importBeatmapsets = async () => {
    console.log('Importing unsaved beatmapsets...');
    const storedMapsetIds = db.prepare(`SELECT id FROM beatmapsets`).all().map(row => row.id);
    const beatmapsetsParser = new SqlDumpParser({ tableName: 'osu_beatmapsets' });
    const stream = fs.createReadStream(`${dumpFolder}/osu_beatmapsets.sql`);
    stream.pipe(beatmapsetsParser);
    let newMapsetCount = 0;
    let newMapCount = 0;
    // Create data saving transaction function
    const stmtInsertMapset = db.prepare(
        `INSERT OR REPLACE INTO beatmapsets
            (id, status, title, artist, time_ranked, mapper)
        VALUES (?, ?, ?, ?, ?, ?)`
    );
    const stmtInsertMap = db.prepare(
        `INSERT OR REPLACE INTO beatmaps
            (id, mapset_id, mode, status, name, stars, is_convert,
            duration_secs, cs, ar, od, hp, bpm)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const transaction = db.transaction((mapset) => {
        // Save mapset
        stmtInsertMapset.run(mapset.id, mapset.status, mapset.title, mapset.artist, new Date(mapset.ranked_date || mapset.submitted_date || undefined).getTime(), mapset.creator);
        // Loop through maps and converts and save
        let mapCount = 0;
        for (const map of [...mapset.beatmaps, ...(mapset.converts || [])]) {
            stmtInsertMap.run(map.id, mapset.id, map.mode, map.status, map.version, map.difficulty_rating, map.convert ? 1 : 0, map.total_length, map.cs, map.ar, map.accuracy, map.drain, map.bpm);
            mapCount++;
        }
        console.log(`Saved mapset ${mapset.id} with ${mapCount} maps: ${mapset.artist} - ${mapset.title}`);
        newMapCount += mapCount;
    });
    // Function to fetch and save a mapset
    const saveMapset = async mapsetId => {
        // Fetch full mapset again to get converts
        let mapsetFull = null;
        while (true) {
            try {
                mapsetFull = await osu.getBeatmapset(mapsetId);
                break;
            } catch (error) {
                console.error(`Error fetching beatmapset ${mapsetId}: ${error}. Retrying in 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        // Save mapset and its maps
        transaction(mapsetFull);
        newMapsetCount++;
    };
    // Loop through dump entries
    for await (const row of beatmapsetsParser) {
        const mapsetId = row.beatmapset_id;
        // Skip if already stored
        if (storedMapsetIds.includes(mapsetId)) continue;
        await saveMapset(mapsetId);
    }
    // Save any other maps that we don't have or that are missing data
    const rows = [
        ...db.prepare(
            `SELECT DISTINCT mapset_id FROM beatmaps WHERE cs IS NULL`
        ).all(),
        ...db.prepare(
            `SELECT DISTINCT mapset_id FROM user_passes
            WHERE mapset_id NOT IN (SELECT id FROM beatmapsets)`
        ).all()
    ];
    console.log(`Found ${rows.length} additional beatmapsets needing import`);
    for (const row of rows) {
        await saveMapset(row.mapset_id);
    }
    // Log and finish
    console.log(`Imported ${newMapsetCount} beatmapsets and ${newMapCount} beatmaps`);
};

async function main() {
    if (!dumpFolder) {
        console.error('Usage: node importBeatmaps.js <path_to_sql_dump_folder>');
        process.exit(1);
    }
    await importBeatmapsets();
}

main().catch(console.error);