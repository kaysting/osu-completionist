const utils = require('#utils');

const definitions = [];

// There's gotta be a better way to do this than nesting 5 for loops inside each other
// but we need all permutations of these variables
for (const mode of ['all', 'osu', 'taiko', 'catch', 'mania']) {
    for (const includeRanked of [false, true]) {
        for (const includeLoved of [false, true]) {
            // Skip instances where we aren't including ranked or loved
            if (!includeRanked && !includeLoved) continue;

            for (const includeConverts of [false, true]) {
                for (const includeSpecifics of [false, true]) {
                    // Skip instances where we aren't including specifics or converts
                    if (!includeConverts && !includeSpecifics) continue;

                    // Skip standard when converts are involved
                    if (mode === 'osu' && (includeConverts || !includeSpecifics)) {
                        continue;
                    }

                    // Initialize definition object
                    const definition = {
                        filters: []
                    };

                    // Build id
                    const idParts = [mode];
                    if (includeRanked) idParts.push('ranked');
                    if (includeLoved) idParts.push('loved');
                    if (mode !== 'osu') {
                        if (includeSpecifics) idParts.push('specifics');
                        if (includeConverts) idParts.push('converts');
                    }
                    definition.id = idParts.join('-');

                    // Build name
                    if (mode == 'all') definition.name = 'All modes';
                    else definition.name = utils.rulesetKeyToName(utils.rulesetNameToKey(mode), true);
                    if (mode == 'mania') definition.name += ' all keys';
                    if (includeRanked && includeLoved) definition.name += ' (ranked and loved';
                    else if (includeRanked) definition.name += ' (ranked';
                    else if (includeLoved) definition.name += ' (loved';
                    if (mode == 'osu') {
                        if (includeRanked && includeLoved) definition.name += ')';
                        else definition.name += ' only)';
                    } else {
                        if (includeSpecifics && includeConverts) definition.name += ' specifics and converts';
                        else if (includeSpecifics) definition.name += ' specifics';
                        else if (includeConverts) definition.name += ' converts';
                        if (includeRanked && includeLoved) definition.name += ')';
                        else definition.name += ' only)';
                    }

                    // Add mode filter
                    if (mode !== 'all') {
                        definition.filters.push({
                            field: 'mode',
                            equals: mode == 'catch' ? 'fruits' : mode
                        });
                    }

                    // Add status filter
                    const statuses = [];
                    if (includeRanked) statuses.push('ranked', 'approved');
                    if (includeLoved) statuses.push('loved');
                    definition.filters.push({
                        field: 'status',
                        in: statuses
                    });

                    // Add converts filter
                    if (!includeConverts) {
                        definition.filters.push({
                            field: 'is_convert',
                            equals: 0
                        });
                    } else if (!includeSpecifics) {
                        definition.filters.push({
                            field: 'is_convert',
                            equals: 1
                        });
                    }

                    // Save finished definition
                    definitions.push(definition);

                    // Add specific keycount categories for mania
                    if (mode === 'mania') {
                        for (const keyCount of [4, 7]) {
                            const keyDefinition = JSON.parse(JSON.stringify(definition));
                            keyDefinition.id += `-${keyCount}k`;
                            keyDefinition.name = keyDefinition.name.replace('all keys', `${keyCount}K`);
                            keyDefinition.filters.push({
                                field: 'cs',
                                equals: keyCount
                            });
                            definitions.push(keyDefinition);
                        }
                        const keyDefinition = JSON.parse(JSON.stringify(definition));
                        keyDefinition.id += `-otherkeys`;
                        keyDefinition.name = keyDefinition.name.replace(' all keys', `, not 4K or 7K`);
                        keyDefinition.filters.push({
                            field: 'cs',
                            notIn: [4, 7]
                        });
                        definitions.push(keyDefinition);
                    }
                }
            }
        }
    }
}

/**
 * Validates a category ID. This function establishes aliases for old and incomplete IDs, mapping them to currently valid ones, then checks if the provided category is valid.
 * @param {string} categoryId Source category ID
 * @returns A valid category ID or `null` if invalid.
 */
const validateCategoryId = categoryId => {
    let result = (categoryId || '')?.toLowerCase();
    const aliases = {
        // Migrations
        'mania-ranked-converts': 'mania-ranked-specifics-converts',
        'mania-ranked-converts-4k': 'mania-ranked-specifics-converts-4k',
        'mania-ranked-converts-7k': 'mania-ranked-specifics-converts-7k',
        'mania-ranked-converts-otherkeys': 'mania-ranked-specifics-converts-otherkeys',
        'mania-ranked-loved-converts': 'mania-ranked-loved-specifics-converts',
        'mania-ranked-loved-converts-4k': 'mania-ranked-loved-specifics-converts-4k',
        'mania-ranked-loved-converts-7k': 'mania-ranked-loved-specifics-converts-7k',
        'mania-ranked-loved-converts-otherkeys': 'mania-ranked-loved-specifics-converts-otherkeys',
        'mania-ranked': 'mania-ranked-specifics',
        'mania-ranked-4k': 'mania-ranked-specifics-4k',
        'mania-ranked-7k': 'mania-ranked-specifics-7k',
        'mania-ranked-otherkeys': 'mania-ranked-specifics-otherkeys',
        'mania-ranked-loved': 'mania-ranked-loved-specifics',
        'mania-ranked-loved-4k': 'mania-ranked-loved-specifics-4k',
        'mania-ranked-loved-7k': 'mania-ranked-loved-specifics-7k',
        'mania-ranked-loved-otherkeys': 'mania-ranked-loved-specifics-otherkeys',
        'taiko-ranked-converts': 'taiko-ranked-specifics-converts',
        'taiko-ranked-loved-converts': 'taiko-ranked-loved-specifics-converts',
        'taiko-ranked': 'taiko-ranked-specifics',
        'taiko-ranked-loved': 'taiko-ranked-loved-specifics',
        'catch-ranked-converts': 'catch-ranked-specifics-converts',
        'catch-ranked-loved-converts': 'catch-ranked-loved-specifics-converts',
        'catch-ranked': 'catch-ranked-specifics',
        'catch-ranked-loved': 'catch-ranked-loved-specifics',
        'global-ranked-converts': 'all-ranked-specifics-converts',
        'global-ranked-loved-converts': 'all-ranked-loved-specifics-converts',
        'global-ranked': 'all-ranked-specifics',
        'global-ranked-loved': 'all-ranked-loved-specifics',
        // Aliases
        all: 'all-ranked-specifics',
        global: 'all-ranked-specifics',
        osu: 'osu-ranked',
        taiko: 'taiko-ranked-specifics',
        catch: 'catch-ranked-specifics',
        mania: 'mania-ranked-specifics'
    };
    result = aliases[result] || result;
    if (!definitions.find(d => d.id === result)) return null;
    return result;
};

const getCategoryNavPaths = (basePath, categoryId, fullQueryString) => {
    // Extract category details
    const split = categoryId.split('-');
    const mode = split[0];
    const includesRanked = split.includes('ranked');
    const includesLoved = split.includes('loved');
    const includesSpecifics = split.includes('specifics') || mode == 'osu';
    const includesConverts = split.includes('converts');
    const specificKeys = categoryId.match(/-(\d+k|otherkeys)$/)?.[1];

    // Build category id segments
    // For the inverted segments, we check if their counterpart is also false so we can re-add it
    const ranked = includesRanked ? '-ranked' : '';
    const loved = includesLoved ? '-loved' : '';
    const converts = includesConverts ? '-converts' : '';
    const specifics = includesSpecifics ? '-specifics' : '';
    const rankedInvert = includesRanked ? (includesLoved ? '' : '-loved') : '-ranked';
    const lovedInvert = includesLoved ? (includesRanked ? '' : '-ranked') : '-loved';
    const specificsInvert = includesSpecifics ? (includesConverts ? '' : '-converts') : '-specifics';
    const convertsInvert = includesConverts ? (includesSpecifics ? '' : '-specifics') : '-converts';
    const keycount = specificKeys ? `-${specificKeys}` : '';
    const query = fullQueryString ? fullQueryString : '';

    // Build paths
    const paths = {
        all: `${basePath}/${['all', ranked, loved, specifics, converts, query].filter(Boolean).join('')}`,
        osu: `${basePath}/${['osu', ranked, loved, query].filter(Boolean).join('')}`,
        taiko: `${basePath}/${['taiko', ranked, loved, specifics, converts, query].filter(Boolean).join('')}`,
        catch: `${basePath}/${['catch', ranked, loved, specifics, converts, query].filter(Boolean).join('')}`,
        mania: `${basePath}/${['mania', ranked, loved, specifics, converts, query].filter(Boolean).join('')}`,
        mania4k: `${basePath}/${['mania', ranked, loved, specifics, converts, '-4k', query].filter(Boolean).join('')}`,
        mania7k: `${basePath}/${['mania', ranked, loved, specifics, converts, '-7k', query].filter(Boolean).join('')}`,
        maniaOther: `${basePath}/${['mania', ranked, loved, specifics, converts, '-otherkeys', query].filter(Boolean).join('')}`,
        toggleRanked: `${basePath}/${[mode, rankedInvert, loved, mode == 'osu' ? '' : specifics, converts, keycount, query].filter(Boolean).join('')}`,
        toggleLoved: `${basePath}/${[mode, ranked, lovedInvert, mode == 'osu' ? '' : specifics, converts, keycount, query].filter(Boolean).join('')}`,
        toggleConverts: `${basePath}/${[mode, ranked, loved, specifics, convertsInvert, keycount, query].filter(Boolean).join('')}`,
        toggleSpecifics: `${basePath}/${[mode, ranked, loved, specificsInvert, converts, keycount, query].filter(Boolean).join('')}`
    };
    return paths;
};

/**
 * Converts a Category ID into SQL WHERE clauses based on its definition.
 * @param {string} categoryId The category ID to look up
 * @param {string} tablePrefix The table alias to prefix columns with (e.g. 'map' or 'b')
 */
const categoryToSql = (categoryId, tablePrefix = 'map') => {
    const def = definitions.find(d => d.id === categoryId);
    if (!def) {
        throw new Error(`Invalid category ID: ${categoryId}`);
    }
    const clauses = [];
    const params = [];
    for (const filter of def.filters) {
        const col = `${tablePrefix}.${filter.field}`;

        if (filter.equals !== undefined) {
            clauses.push(`${col} = ?`);
            params.push(filter.equals);
        } else if (filter.in !== undefined) {
            const placeholders = filter.in.map(() => '?').join(', ');
            clauses.push(`${col} IN (${placeholders})`);
            params.push(...filter.in);
        } else if (filter.notIn !== undefined) {
            const placeholders = filter.notIn.map(() => '?').join(', ');
            clauses.push(`${col} NOT IN (${placeholders})`);
            params.push(...filter.notIn);
        } else if (filter.range !== undefined) {
            clauses.push(`${col} BETWEEN ? AND ?`);
            params.push(filter.range[0], filter.range[1]);
        } else if (filter.min !== undefined) {
            clauses.push(`${col} >= ?`);
            params.push(filter.min);
        } else if (filter.max !== undefined) {
            clauses.push(`${col} <= ?`);
            params.push(filter.max);
        }
    }
    return {
        where: clauses.length > 0 ? clauses.join(' AND ') : '1=1',
        params,
        def
    };
};

const getCategoryName = categoryId => {
    const def = definitions.find(d => d.id === categoryId);
    if (!def) return 'Unknown category';
    return def.name;
};

// If not required from another module, output the definitions
if (require.main === module) {
    console.log(
        `Registered ${definitions.length} stat category definitions:`,
        definitions.map(d => `${d.id}: ${d.name}`).join('\n')
    );
}

module.exports = {
    definitions,
    validateCategoryId,
    getCategoryNavPaths,
    categoryToSql,
    getCategoryName
};
