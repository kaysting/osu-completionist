// WRITTEN ENTIRELY BY GEMINI
// Because a module for this doesn't already exist for some reason

const { Transform } = require('stream');

class SqlDumpParser extends Transform {
    constructor(options) {
        // objectMode: true allows us to push objects (rows) instead of just text
        super({ objectMode: true, decodeStrings: false }); 
        
        this.tableName = options.tableName;
        
        // Internal State
        this.buffer = '';
        this.columns = null; 
        
        // State Machine Flags
        this.inInsertStatement = false;
        this.readingSchema = false; // New flag to protect buffer during schema read
        
        this.inQuote = false;
        this.isEscaped = false;
        this.rowBuffer = '';
        this.inRow = false;
    }

    /**
     * Transform stream method. 
     * Handles incoming file chunks and pushes out row objects.
     */
    _transform(chunk, encoding, callback) {
        this.buffer += chunk.toString('utf8');

        // 1. Try to find schema if we haven't yet
        if (!this.columns) {
            this._tryParseSchema();
        }

        // 2. Process Inserts
        // We wrap this in a try/catch to ensure we always call the callback
        try {
            this._processBuffer();
            callback(); // Ready for next chunk
        } catch (err) {
            callback(err);
        }
    }

    _tryParseSchema() {
        // Regex to find start: CREATE TABLE [optional quotes] tableName ...
        // We use [^]*? for non-greedy multiline matching
        // We support `backticks` or 'single quotes' around table names
        const headerRegex = new RegExp(`CREATE TABLE\\s+[\`'"]?${this.tableName}[\`'"]?\\s*\\(`, 'i');
        
        // If we aren't already tracking the schema, look for the header
        if (!this.readingSchema) {
            const match = this.buffer.match(headerRegex);
            if (match) {
                this.readingSchema = true;
                // Trim everything before the CREATE TABLE to keep buffer clean
                this.buffer = this.buffer.substring(match.index);
            }
        }

        // If we ARE reading schema, look for the closing semicolon
        if (this.readingSchema) {
            const endIdx = this.buffer.indexOf(';');
            if (endIdx !== -1) {
                // We have the full statement now!
                const fullStatement = this.buffer.substring(0, endIdx);
                this.columns = this._extractColumns(fullStatement);
                
                // Done reading schema
                this.readingSchema = false;
                this.emit('schema', this.columns); // Optional event

                // Remove the CREATE statement from buffer
                this.buffer = this.buffer.substring(endIdx + 1);
            }
        }
    }

    _extractColumns(body) {
        const columns = [];
        const lines = body.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            
            // Filter out SQL noise to find lines that start with a column name
            if (
                !trimmed ||
                trimmed.startsWith('CREATE TABLE') ||
                trimmed.startsWith('PRIMARY KEY') ||
                trimmed.startsWith('KEY') ||
                trimmed.startsWith('UNIQUE KEY') ||
                trimmed.startsWith('CONSTRAINT') ||
                trimmed.startsWith(')') ||
                trimmed.startsWith('/*') 
            ) {
                continue;
            }

            // Extract the first quoted string. 
            // Matches `name` or 'name'
            const colMatch = trimmed.match(/^[`'"]([^`'"]+)[`'"]/);
            if (colMatch) {
                columns.push(colMatch[1]);
            }
        }
        return columns;
    }

    _processBuffer() {
        // If we haven't found the INSERT statement yet, look for it
        if (!this.inInsertStatement) {
            const searchPattern = `INSERT INTO \`${this.tableName}\` VALUES`;
            const idx = this.buffer.indexOf(searchPattern);

            if (idx !== -1) {
                this.inInsertStatement = true;
                this.buffer = this.buffer.slice(idx + searchPattern.length);
            } else {
                // MEMORY PROTECTION:
                // Only trim buffer if we are NOT currently trying to read the schema.
                // If we are reading schema, we need the buffer to grow until we find the ';'.
                if (!this.readingSchema && this.buffer.length > 5000) { 
                    this.buffer = this.buffer.slice(-200);
                }
                return; 
            }
        }

        // --- ROW PARSING STATE MACHINE ---
        let charIndex = 0;
        
        while (charIndex < this.buffer.length) {
            const char = this.buffer[charIndex];

            // Handle Escapes
            if (this.isEscaped) {
                this.isEscaped = false;
                if (this.inRow) this.rowBuffer += char;
                charIndex++;
                continue;
            }
            if (char === '\\') {
                this.isEscaped = true;
                if (this.inRow) this.rowBuffer += char;
                charIndex++;
                continue;
            }

            // Handle Quotes
            if (char === "'") {
                this.inQuote = !this.inQuote;
                if (this.inRow) this.rowBuffer += char;
                charIndex++;
                continue;
            }

            // Handle Row Start
            if (!this.inRow && !this.inQuote && char === '(') {
                this.inRow = true;
                this.rowBuffer = ''; 
                charIndex++;
                continue;
            }

            // Handle Row End
            if (this.inRow && !this.inQuote && char === ')') {
                this.inRow = false;
                
                // Parse and Push
                const values = this._parseRowString(this.rowBuffer);
                
                if (this.columns && values.length === this.columns.length) {
                    const rowObj = {};
                    this.columns.forEach((col, i) => {
                        rowObj[col] = values[i];
                    });
                    // *** THIS IS THE KEY CHANGE ***
                    // We push to the internal read queue. 
                    // This pauses the stream if the consumer is slow.
                    this.push(rowObj); 
                } else {
                    this.push(values);
                }

                this.rowBuffer = '';
                charIndex++;
                continue;
            }

            // Handle Statement End
            if (!this.inQuote && char === ';') {
                this.inInsertStatement = false;
                this.buffer = this.buffer.slice(charIndex + 1);
                return; 
            }

            // Capture Data
            if (this.inRow) {
                this.rowBuffer += char;
            }
            
            charIndex++;
        }

        this.buffer = this.buffer.slice(charIndex);
    }

    _parseRowString(rawString) {
        const values = [];
        let currentVal = '';
        let inQuote = false;
        let isEscaped = false;

        for (let i = 0; i < rawString.length; i++) {
            const char = rawString[i];

            if (isEscaped) {
                currentVal += char;
                isEscaped = false;
                continue;
            }
            if (char === '\\') {
                isEscaped = true;
                continue;
            }
            if (char === "'") {
                inQuote = !inQuote;
                continue; 
            }
            if (char === ',' && !inQuote) {
                values.push(this._cleanValue(currentVal));
                currentVal = '';
                continue;
            }
            currentVal += char;
        }
        values.push(this._cleanValue(currentVal));
        return values;
    }

    _cleanValue(val) {
        val = val.trim();
        if (val === 'NULL') return null;
        if (!isNaN(val) && val !== '') return Number(val);
        return val;
    }
}

module.exports = SqlDumpParser;