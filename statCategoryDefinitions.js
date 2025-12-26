const definitions = [];

for (const mode of ['osu', 'taiko', 'catch', 'mania']) {
    for (const includeLoved of [false, true]) {
        for (const includeConverts of [false, true]) {
            if (mode === 'osu' && includeConverts) {
                // standard has no converts
                continue;
            }
            const definition = {};
            definition.id = [
                mode, 'ranked',
                includeLoved ? 'loved' : '',
                includeConverts ? 'converts' : ''
            ].filter(Boolean).join('-');
            definition.filters = [];
            definition.filters.push({
                field: 'mode',
                equals: mode == 'catch' ? 'fruits' : mode
            });
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
            }
        }
    }
}

// If not required from another module, output the definitions
if (require.main === module) {
    console.log(`Registered ${definitions.length} stat category definitions:`, definitions.map(d => d.id).join(', '));
    console.log(JSON.stringify(definitions, null, 2));
}

module.exports = definitions;