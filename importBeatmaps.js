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
    // Handle saving mapsets
    const insertMapset = db.prepare(`INSERT OR REPLACE INTO beatmapsets (id, status, title, artist, time_ranked) VALUES (?, ?, ?, ?, ?)`);
    const insertBeatmap = db.prepare(`INSERT OR REPLACE INTO beatmaps (id, mapset_id, mode, status, name, stars, is_convert, duration_secs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const save = db.transaction((mapset) => {
        // Save mapset
        insertMapset.run(mapset.id, mapset.status, mapset.title, mapset.artist, new Date(mapset.ranked_date || mapset.submitted_date || undefined).getTime());
        // Loop through maps and converts and save
        let mapCount = 0;
        for (const map of [...mapset.beatmaps, ...(mapset.converts || [])]) {
            insertBeatmap.run(map.id, mapset.id, map.mode, map.status, map.version, map.difficulty_rating, map.convert ? 1 : 0, map.total_length);
            mapCount++;
        }
        console.log(`Saved mapset ${mapset.id} with ${mapCount} maps: ${mapset.artist} - ${mapset.title}`);
        newMapCount += mapCount;
    });
    // Loop through dump entries
    for await (const row of beatmapsetsParser) {
        const mapsetId = parseInt(row.beatmapset_id);
        // Skip if already stored
        if (storedMapsetIds.includes(mapsetId)) continue;
        // Fetch full mapset again to get converts
        const mapsetFull = await osu.getBeatmapset(mapsetId);
        // Save mapset and its maps
        save(mapsetFull);
        newMapsetCount++;
    }
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