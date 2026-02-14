const process = require('process');
const clc = require('cli-color');

const printTable = data => {
    if (!data || data.length === 0) return;

    // 1. Normalize input
    const rows = Array.isArray(data) ? data : [data];
    const headers = Object.keys(rows[0]);

    // 2. Config & Terminal Sizing
    const paddingX = 1;
    const overheadPerCol = 1 + paddingX * 2;
    const totalOverhead = headers.length * overheadPerCol + 1;

    const terminalWidth = process.stdout.columns && process.stdout.columns > 20 ? process.stdout.columns : 100;

    const availableWidth = terminalWidth - totalOverhead;

    // 3. Analyze Columns
    const colSpecs = headers.map(header => {
        let maxContentLen = header.length;
        let maxWordLen = 0;

        const scanWords = str => {
            String(str)
                .split(' ')
                .forEach(w => {
                    maxWordLen = Math.max(maxWordLen, w.length);
                });
        };

        scanWords(header);

        rows.forEach(row => {
            const val = row[header] === null ? 'NULL' : String(row[header]);
            maxContentLen = Math.max(maxContentLen, val.length);
            scanWords(val);
        });

        return {
            header,
            ideal: maxContentLen,
            minSafe: Math.min(Math.max(5, maxWordLen), 15),
            width: maxContentLen
        };
    });

    // 4. Width Allocator
    let totalUsed = colSpecs.reduce((sum, c) => sum + c.width, 0);

    if (totalUsed > availableWidth) {
        let attempts = 0;
        while (totalUsed > availableWidth && attempts < 1000) {
            let targetCol = null;
            let maxExcess = 0;

            colSpecs.forEach(col => {
                const excess = col.width - col.minSafe;
                if (excess > maxExcess) {
                    maxExcess = excess;
                    targetCol = col;
                }
            });

            if (!targetCol) break;

            targetCol.width--;
            totalUsed--;
            attempts++;
        }
    }

    // 5. Word Wrapper
    const wrapText = (text, width) => {
        if (text === null || text === undefined) return [];
        const str = String(text);
        if (str.length === 0) return [];

        const words = str.split(' ');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            if (currentLine.length + 1 + words[i].length <= width) {
                currentLine += ' ' + words[i];
            } else {
                lines.push(currentLine);
                currentLine = words[i];
            }
        }
        lines.push(currentLine);

        return lines.flatMap(line => {
            if (line.length > width) {
                return line.match(new RegExp(`.{1,${width}}`, 'g')) || [line];
            }
            return [line];
        });
    };

    // 6. Drawing Helpers

    // Helper to print a dim border line
    const drawDivider = (char = '-') => {
        const parts = colSpecs.map(c => char.repeat(c.width + paddingX * 2));
        // We assume the user wants the border lines to be subtle (dim)
        console.log(clc.blackBright(`+${parts.join('+')}+`));
    };

    const drawRow = (rowCells, colorFn = str => str) => {
        const wrappedCols = rowCells.map((val, idx) => wrapText(val, colSpecs[idx].width));
        const maxLines = Math.max(...wrappedCols.map(c => c.length), 1);

        for (let i = 0; i < maxLines; i++) {
            // Start the line with a dim pipe
            let lineStr = clc.blackBright('|');

            colSpecs.forEach((spec, idx) => {
                const text = wrappedCols[idx][i] || '';

                // IMPORTANT: Pad the PLAIN text first to ensure alignment stays perfect
                const paddedText = text.padEnd(spec.width, ' ');

                // Now apply color to the content
                const cellContent = colorFn(paddedText);

                // Add padding spaces (uncolored) and the closing pipe (dim)
                lineStr += ' ' + cellContent + ' ' + clc.blackBright('|');
            });
            console.log(lineStr);
        }
    };

    // 7. Execution
    drawDivider('-');

    // HEADERS: Cyan and Bold
    drawRow(headers, str => clc.cyanBright.bold(str));

    drawDivider('=');

    // DATA: Alternate rows
    rows.forEach((row, index) => {
        const vals = headers.map(h => (row[h] === null ? 'NULL' : String(row[h])));

        // Alternating logic: Even rows standard, Odd rows dim (gray)
        const rowColor = index % 2 === 0 ? clc.whiteBright : clc.whiteBright.bold;

        drawRow(vals, rowColor);
        drawDivider('-');
    });
};

module.exports = printTable;
