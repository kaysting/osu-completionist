const env = require('#env');
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const clc = require('cli-color');
const dayjs = require('dayjs');
const axios = require('axios');
const tar = require('tar');
const bz2 = require('unbzip2-stream');
const SqlDumpParser = require('#lib/SqlDumpParser.js');
const db = require('#db');
const apiRead = require('#api/read.js');
const apiWrite = require('#api/write.js');
const utils = require('#utils');

const importBeatmapsets = async dumpFolder => {
    if (!dumpFolder) dumpFolder = path.resolve(env.ROOT, 'temp', `dump_${dayjs().set('date', 1).format('YYYY-MM-DD')}`);
    const dumpFileName = 'osu_beatmapsets.sql';
    const dumpFilePath = path.resolve(dumpFolder, dumpFileName);
    if (!fs.existsSync(dumpFilePath)) {
        console.error(
            `Failed to locate dump file at expected path: ${dumpFilePath}\nConsider using the dump download maintenance function, then run import again leaving the dump folder path blank.`
        );
        return;
    }

    console.log(`Discovering missing beatmapsets from ${dumpFilePath}...`);
    const storedMapsetIds = db
        .prepare(`SELECT id FROM beatmapsets`)
        .all()
        .map(row => row.id);
    const beatmapsetsParser = new SqlDumpParser({ tableName: 'osu_beatmapsets' });
    const stream = fs.createReadStream(dumpFilePath);
    stream.pipe(beatmapsetsParser);
    const mapsetIdsToSave = [];
    // Loop through dump entries to find missing mapsets
    for await (const row of beatmapsetsParser) {
        const mapsetId = row.beatmapset_id;
        if (storedMapsetIds.includes(mapsetId)) continue;
        mapsetIdsToSave.push(mapsetId);
    }

    let newMapsetCount = 0;
    if (mapsetIdsToSave.length > 0) {
        console.log(`Importing ${mapsetIdsToSave.length} missing beatmapsets...`);
        for (const mapsetId of mapsetIdsToSave) {
            await apiWrite.saveMapset(mapsetId);
            newMapsetCount++;
        }
    } else {
        console.log(`Dump revealed no missing beatmapsets.`);
    }

    console.log(`Importing incomplete beatmaps...`);
    // Save any other maps that we don't have or that are missing data
    const rows = [
        // beatmaps missing cs
        ...db.prepare(`SELECT DISTINCT mapset_id FROM beatmaps WHERE cs IS NULL`).all(),
        // beatmaps users have passed but we don't have data for
        ...db
            .prepare(
                `SELECT DISTINCT mapset_id FROM user_passes
            WHERE mapset_id NOT IN (SELECT id FROM beatmapsets)`
            )
            .all(),
        // mapsets with no maps
        ...db
            .prepare(
                `SELECT id AS mapset_id FROM beatmapsets
            WHERE id NOT IN (SELECT DISTINCT mapset_id FROM beatmaps)`
            )
            .all()
    ];
    for (const row of rows) {
        await apiWrite.saveMapset(row.mapset_id, false);
        newMapsetCount++;
    }

    // Log import results
    console.log(`Imported a total of ${newMapsetCount} beatmapsets`);

    // Repopulate the search table
    const insertIntoIndex = db.prepare(`
        INSERT INTO beatmaps_search (title, artist, name, map_id, mode)
        VALUES (?, ?, ?, ?, ?)
    `);
    const rebuildSearchIndex = db.transaction(() => {
        // Get all maps
        const maps = db
            .prepare(
                `
            SELECT b.id AS map_id, b.mode, b.name, bs.title, bs.artist
            FROM beatmaps b
            JOIN beatmapsets bs ON b.mapset_id = bs.id
        `
            )
            .all();
        console.log(`Rebuilding beatmap search index with ${maps.length} entries`);
        // Clear index
        db.prepare(`DELETE FROM beatmaps_search`).run();
        // Insert missing maps into search index
        for (const row of maps) {
            insertIntoIndex.run(row.title, row.artist, row.name, row.map_id, row.mode);
        }
    });

    const count = rebuildSearchIndex();

    // Optimize
    if (count > 1000) {
        console.log('Optimizing FTS index...');
        db.prepare("INSERT INTO beatmaps_search(beatmaps_search) VALUES('optimize')").run();
    }

    // Recalculate beatmap stats
    console.log('Updating beatmap stats...');
    apiWrite.updateUserCategoryStats(0); // id 0 stores totals
};

const schemaPath = path.resolve(env.ROOT, 'database/schema.sql');

const readSchema = () => {
    cp.execSync(`sqlite3 "${env.DB_PATH}" .read "${schemaPath}"`);
};

const dumpSchema = () => {
    console.log(`Dumping database schema to ${schemaPath}...`);
    cp.execSync(`sqlite3 "${env.DB_PATH}" .schema > "${schemaPath}"`);
};

const downloadDump = () =>
    new Promise(async (resolve, reject) => {
        try {
            // Determine path and create output directory
            const date = dayjs().set('date', 1);
            const outputDir = path.resolve(env.ROOT, 'temp', `dump_${date.format('YYYY-MM-DD')}`);
            if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
            fs.mkdirSync(outputDir, { recursive: true });
            console.log(`Output directory: ${outputDir}`);
            console.log(`Downloading and extracting dump, this might take a bit...`);

            // Start download and get stream
            let lastDownloadLog = Date.now();
            const stream = await axios({
                method: 'GET',
                url: `https://data.ppy.sh/${date.format('YYYY_MM_DD')}_performance_osu_top_1000.tar.bz2`,
                responseType: 'stream',
                onDownloadProgress: e => {
                    const percent = ((e.loaded / e.total) * 100).toFixed(2);
                    if (Date.now() - lastDownloadLog > 1000) {
                        const loadedM = Math.floor(e.loaded / (1024 * 1024));
                        const totalM = Math.floor(e.total / (1024 * 1024));
                        console.log(`Download progress: ${percent}% (${loadedM}MB / ${totalM}MB)`);
                        lastDownloadLog = Date.now();
                    }
                }
            });

            // Pipe download stream through bz2 and tar extractors
            const extraction = stream.data.pipe(bz2()).pipe(
                tar.x({
                    cwd: outputDir,
                    strip: 1
                })
            );

            // Handle extraction events
            extraction.on('finish', () => {
                console.log('Done!');
                resolve();
            });
            extraction.on('error', err => {
                console.error('Error during extraction:', err);
            });
        } catch (error) {
            return console.error('Error during download:', error.message);
        }
    });

const options = [
    {
        f: readSchema,
        name: `makedb`,
        description: `Create/update the database using schema.sql.`
    },
    {
        f: apiWrite.backupDatabase,
        name: `backupdb`,
        description: `Create a backup of the current database. Consider stopping the updater first.`
    },
    {
        f: dumpSchema,
        name: `dump`,
        description: `Export the current database schema to schema.sql.`
    },
    {
        f: downloadDump,
        name: `dldump`,
        description: `Download and extract the latest data.ppy.sh dump to a temp folder.`
    },
    {
        f: importBeatmapsets,
        name: `importmaps`,
        description: `Import any missing beatmaps(ets) using IDs from a data.ppy.sh dump.\nDump folder path defaults to where the download function saves.`,
        args: [{ name: 'path_to_dump_folder' }]
    },
    {
        f: userId => {
            if (!userId) apiWrite.updateAllUserCategoryStats();
            else apiWrite.updateUserCategoryStats(parseInt(userId));
        },
        name: `updatestats`,
        description: `Recalculate category stats for all users and totals or for a specific user.`,
        args: [{ name: 'user_id' }]
    },
    {
        f: async userId => {
            if (!userId) {
                return apiWrite.savePassesFromAllUserRecents();
            }
            const user = await apiRead.getUserProfile(userId);
            if (!user?.name) return console.log(`User ${userId} not found`);
            await apiWrite.savePassesFromUserRecents(userId);
        },
        name: `saverecentpasses`,
        description: `Save the past 24 hours of user passes using per-user recent scores.`,
        args: [{ name: 'user_id' }]
    },
    {
        f: () => console.log(`Here's a cryptographically securely random secret:\n${utils.generateSecretKey(32)}`),
        name: `getsecret`,
        description: `Generate a cryptographically securely random secret key for use in configuration.`
    },
    {
        f: async (userId, full = false) => {
            await apiWrite.updateUserProfile(userId);
            await apiWrite.queueUserForImport(userId, full);
        },
        name: `queueuser`,
        description: `Add a user to the import queue.`,
        args: [
            { name: 'user_id', required: true },
            { name: 'full', required: false }
        ]
    },
    {
        f: apiWrite.unqueueUser,
        name: `unqueueuser`,
        description: `Remove a user from the import queue.`,
        args: [{ name: 'user_id', required: true }]
    },
    {
        f: apiWrite.generateSitemap,
        name: `makesitemap`,
        description: `Generate and save an updated sitemap.xml.`,
        args: []
    }
];

const args = process.argv.slice(2);
let optionName = args[0];
let optionArgs = args.slice(1);

async function main() {
    const option = options.find(o => o.name === optionName);
    if (!option || optionName === 'help') {
        for (const option of options) {
            console.log(
                clc.cyan(option.name),
                (option.args || [])
                    .map(a => (a.required ? clc.yellowBright(`<${a.name}>`) : clc.whiteBright(`[${a.name}]`)))
                    .join(' ')
            );
            console.log(clc.blackBright(option.description || ''));
        }
    } else {
        console.log(`\nRunning`, clc.cyan(option.name));
        const finalArgs = [];
        if (option.args) {
            for (let i = 0; i < option.args.length; i++) {
                const argDef = option.args[i];
                const argValue = optionArgs[i];
                if (argDef.required && !argValue) {
                    return console.error(
                        clc.redBright(`${utils.ordinalSuffix(i + 1)} argument expects ${argDef.name}`)
                    );
                }
                console.log(
                    `  `,
                    clc.yellowBright(argDef.name),
                    '=',
                    clc.whiteBright(argValue || clc.blackBright('default'))
                );
                finalArgs.push(argValue);
            }
        }
        console.log();
        await option.f(...finalArgs);
    }
    process.exit();
}
main();
