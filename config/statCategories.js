const utils = require('#utils');

const definitions = [];

for (const mode of ['global', 'osu', 'taiko', 'catch', 'mania']) {
    for (const includeLoved of [false, true]) {
        for (const includeConverts of [false, true]) {
            if (mode === 'osu' && includeConverts) {
                // standard has no converts
                continue;
            }
            const definition = {};
            definition.id = [mode, 'ranked', includeLoved ? 'loved' : '', includeConverts ? 'converts' : '']
                .filter(Boolean)
                .join('-');
            definition.filters = [];
            if (mode !== 'global') {
                definition.filters.push({
                    field: 'mode',
                    equals: mode == 'catch' ? 'fruits' : mode
                });
            }
            definition.filters.push({
                field: 'status',
                in: includeLoved ? ['ranked', 'approved', 'loved'] : ['ranked', 'approved']
            });
            if (!includeConverts) {
                definition.filters.push({
                    field: 'is_convert',
                    equals: 0
                });
            }
            definitions.push(definition);
            // Add specific keycount categories for mania
            if (mode === 'mania') {
                for (const keyCount of [4, 7]) {
                    const maniaKeyCountDefinition = JSON.parse(JSON.stringify(definition));
                    maniaKeyCountDefinition.id += `-${keyCount}k`;
                    maniaKeyCountDefinition.filters.push({
                        field: 'cs',
                        equals: keyCount
                    });
                    definitions.push(maniaKeyCountDefinition);
                }
                const maniaOtherDefinition = JSON.parse(JSON.stringify(definition));
                maniaOtherDefinition.id += `-otherkeys`;
                maniaOtherDefinition.filters.push({
                    field: 'cs',
                    notIn: [4, 7]
                });
                definitions.push(maniaOtherDefinition);
            }
        }
    }
}

const getCategoryNavPaths = (basePath, categoryId, fullQueryString) => {
    // Extract category details
    const split = categoryId.split('-');
    const mode = split[0];
    const includesLoved = split.includes('loved');
    const includesConverts = split.includes('converts');
    const keys = categoryId.match(/-(\d+k|otherkeys)$/)?.[1];
    const loved = includesLoved ? '-loved' : '';
    const converts = includesConverts ? '-converts' : '';
    const lovedInvert = includesLoved ? '' : '-loved';
    const convertsInvert = includesConverts ? '' : '-converts';
    let segmentKeycount = '';
    if (keys) {
        segmentKeycount = `-${keys}`;
    }
    const query = fullQueryString ? fullQueryString : '';
    const paths = {
        global: `${basePath}/global-ranked${loved}${converts}${query}`,
        osu: `${basePath}/osu-ranked${loved}${query}`,
        taiko: `${basePath}/taiko-ranked${loved}${converts}${query}`,
        catch: `${basePath}/catch-ranked${loved}${converts}${query}`,
        mania: `${basePath}/mania-ranked${loved}${converts}${query}`,
        mania4k: `${basePath}/mania-ranked${loved}${converts}-4k${query}`,
        mania7k: `${basePath}/mania-ranked${loved}${converts}-7k${query}`,
        maniaOther: `${basePath}/mania-ranked${loved}${converts}-otherkeys${query}`,
        toggleConverts: `${basePath}/${mode}-ranked${loved}${convertsInvert}${segmentKeycount}${query}`,
        toggleLoved: `${basePath}/${mode}-ranked${lovedInvert}${converts}${segmentKeycount}${query}`
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
    const segments = [];
    // Extract category details
    const split = categoryId.split('-');
    const mode = split[0];
    const includesLoved = split.includes('loved');
    const includesConverts = split.includes('converts');
    const keyCount = categoryId.match(/-(\d+k|otherkeys)$/)?.[1];
    // Build mode name
    if (mode == 'global') {
        segments.push('All modes');
    } else {
        segments.push(utils.rulesetKeyToName(utils.rulesetNameToKey(mode), true));
    }
    // Add mania keycount
    if (keyCount === 'otherkeys') {
        segments.push('(not 4K or 7K)');
    } else if (keyCount) {
        segments.push(keyCount.toUpperCase());
    }
    // Add includes
    const includes = [];
    if (includesLoved) {
        includes.push('ranked and loved');
    } else {
        includes.push('ranked only');
    }
    if (includesConverts) {
        includes.push('with converts');
    }
    segments.push(`(${includes.join(', ')})`);
    // Combine and return
    return segments.join(' ');
};

// If not required from another module, output the definitions
if (require.main === module) {
    console.log(
        `Registered ${definitions.length} stat category definitions:`,
        definitions.map(d => `${d.id}: ${getCategoryName(d.id)}`).join('\n')
    );
}

module.exports = {
    definitions,
    getCategoryNavPaths,
    categoryToSql,
    getCategoryName
};
