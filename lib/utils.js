const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');
const env = require('#env');

const utils = {
    sendDiscordMessage: async (channelId, message) => {
        try {
            if (!channelId || !env.DISCORD_BOT_TOKEN) return;
            await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, message, {
                headers: {
                    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            console.error(`Failed sending Discord message: ${error}`, JSON.stringify(error?.response?.data, null, 2));
        }
    },

    parseArgsToDiscordContent: args => {
        return args
            .map(arg => {
                if (arg instanceof Error) {
                    return `\`\`\`${arg.stack}\`\`\``;
                } else if (typeof arg === 'object') {
                    return `\`\`\`json\n${JSON.stringify(arg, null, 2)}\`\`\``;
                } else {
                    return arg.toString();
                }
            })
            .join('\n');
    },

    log: (...args) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}]`, ...args);
    },

    logError: (...args) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}]`, ...args);
        utils.sendDiscordMessage(env.ERROR_LOGS_DISCORD_CHANNEL_ID, {
            content: utils.parseArgsToDiscordContent(args)
        });
    },

    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),

    rulesetNameToKey: name => {
        if (typeof name === 'string') name = name.toLowerCase();
        switch (name) {
            case 'osu!':
            case 'osu':
            case 'osu!standard':
            case 'standard':
            case 'std':
            case 'circles':
            case 0:
                return 'osu';
            case 'osu!taiko':
            case 'taiko':
            case 'drums':
            case 1:
                return 'taiko';
            case 'osu!catch':
            case 'osu!ctb':
            case 'ctb':
            case 'catch':
            case 'fruits':
            case 2:
                return 'fruits';
            case 'osu!mania':
            case 'mania':
            case 'keys':
            case 3:
                return 'mania';
            default:
                return null;
        }
    },

    rulesetKeyToName: (key, full = false) => {
        key = utils.rulesetNameToKey(key) || key.toLowerCase();
        switch (key) {
            case 'osu':
                return full ? 'osu!standard' : 'osu';
            case 'taiko':
                return full ? 'osu!taiko' : 'taiko';
            case 'fruits':
                return full ? 'osu!catch' : 'catch';
            case 'mania':
                return full ? 'osu!mania' : 'mania';
            default:
                return null;
        }
    },

    getRelativeTimestamp: (ts, origin = Date.now(), includeSuffix = true) => {
        const diff = ts - origin;
        const suffix = diff < 0 ? ' ago' : ' from now';
        const format = (value, unit) => {
            return `${value} ${unit}${value !== 1 ? 's' : ''}${includeSuffix ? suffix : ''}`;
        };
        let absDiff = Math.abs(diff);
        absDiff /= 1000;
        if (absDiff < 60) return format(Math.floor(absDiff), 'second');
        absDiff /= 60;
        if (absDiff < 60) return format(Math.floor(absDiff), 'minute');
        absDiff /= 60;
        if (absDiff < 24) return format(Math.floor(absDiff), 'hour');
        absDiff /= 24;
        if (absDiff < 30) return format(Math.floor(absDiff), 'day');
        if (absDiff / 7 < 4) return format(Math.floor(absDiff / 7), 'week');
        absDiff /= 30;
        if (absDiff < 12) return format(Math.floor(absDiff), 'month');
        absDiff /= 12;
        return format(Math.floor(absDiff), 'year');
    },

    rgbToHsl: (r, g, b) => {
        // WRITTEN BY GEMINI
        // 1. Normalize r, g, b to range [0, 1]
        r /= 255;
        g /= 255;
        b /= 255;

        // 2. Find the maximum and minimum values to calculate lightness
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h,
            s,
            l = (max + min) / 2;

        // 3. Calculate Saturation and Hue
        if (max === min) {
            // Achromatic (gray), no saturation or hue
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
            }
            h /= 6;
        }

        // 4. Return as array of integers: [0-360, 0-100, 0-100]
        return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
    },

    rgbToHex: (r, g, b) => {
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
    },

    hslToHex: (h, s, l) => {
        l /= 100;
        const a = (s * Math.min(l, 1 - l)) / 100;

        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color)
                .toString(16)
                .padStart(2, '0');
        };

        return `#${f(0)}${f(8)}${f(4)}`;
    },

    starsToColor: stars => {
        const starGradientPoints = [
            { stars: 0, color: [128, 128, 128] },
            { stars: 0.0999, color: [128, 128, 128] },
            { stars: 0.1, color: [64, 146, 250] },
            { stars: 2, color: [78, 255, 214] },
            { stars: 2.5, color: [121, 255, 88] },
            { stars: 3.3, color: [245, 240, 92] },
            { stars: 4, color: [250, 156, 104] },
            { stars: 5, color: [246, 79, 120] },
            { stars: 6, color: [179, 76, 193] },
            { stars: 6.7, color: [99, 98, 220] },
            { stars: 8, color: [0, 0, 0] }
        ];
        if (stars < 0) stars = 0;
        if (stars > 8) stars = 8;
        for (let i = 0; i < starGradientPoints.length - 1; i++) {
            const pointA = starGradientPoints[i];
            const pointB = starGradientPoints[i + 1];
            if (stars >= pointA.stars && stars <= pointB.stars) {
                const ratio = (stars - pointA.stars) / (pointB.stars - pointA.stars);
                const r = Math.round(pointA.color[0] + ratio * (pointB.color[0] - pointA.color[0]));
                const g = Math.round(pointA.color[1] + ratio * (pointB.color[1] - pointA.color[1]));
                const b = Math.round(pointA.color[2] + ratio * (pointB.color[2] - pointA.color[2]));
                return [r, g, b];
            }
        }
        return [128, 128, 128];
    },

    percentageToColor: percentage =>
        utils.interpolateColors(percentage, [
            [245, 61, 122],
            [245, 214, 61],
            [61, 245, 153]
        ]),

    secsToDuration: (secs, rounded = false, include = ['s', 'm', 'h', 'd']) => {
        if (secs === 0) return rounded ? '0 secs' : '0s';

        // Return rounded
        if (rounded) {
            if (secs >= 86400 && include.includes('d')) {
                const days = Math.round(secs / 86400);
                return `${utils.formatNumber(days)} day${days !== 1 ? 's' : ''}`;
            }
            if (secs >= 3600 && include.includes('h')) {
                const hours = Math.round(secs / 3600);
                return `${utils.formatNumber(hours)} hour${hours !== 1 ? 's' : ''}`;
            }
            if (secs >= 60 && include.includes('m')) {
                const mins = Math.round(secs / 60);
                return `${utils.formatNumber(mins)} min${mins !== 1 ? 's' : ''}`;
            }
            return `${Math.round(secs)} sec${Math.round(secs) !== 1 ? 's' : ''}`;
        }

        const parts = [];

        // Extract Days
        if (include.includes('d')) {
            const days = Math.floor(secs / 86400);
            if (days > 0) {
                parts.push(`${utils.formatNumber(days)}d`);
                secs %= 86400; // Remove the days from the seconds pool
            }
        }

        // Extract Hours
        if (include.includes('h')) {
            const hours = Math.floor(secs / 3600);
            if (hours > 0) {
                parts.push(`${utils.formatNumber(hours)}h`);
                secs %= 3600;
            }
        }

        // Extract Minutes
        if (include.includes('m')) {
            const minutes = Math.floor(secs / 60);
            if (minutes > 0) {
                parts.push(`${utils.formatNumber(minutes)}m`);
                secs %= 60;
            }
        }

        // Extract Seconds
        if (include.includes('s') && secs > 0) {
            // Handle floating point seconds if needed, otherwise floor it
            parts.push(`${utils.formatNumber(secs)}s`);
        }

        return parts.join(' ');
    },

    /**
     * Interpolates between an array of colors based on a percentage.
     * @param {number} percentage - value between 0 and 1
     * @param {Array<Array<number>>} colors - Array of [r, g, b] arrays
     * @returns {string} - CSS rgb string, e.g., "rgb(255, 0, 0)"
     */
    interpolateColors: (percentage, colors) => {
        // 1. Safety checks
        if (!colors || colors.length === 0) return 'rgb(0,0,0)';
        if (colors.length === 1) {
            const c = colors[0];
            return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        }

        // 2. Clamp percentage between 0 and 1
        const p = Math.max(0, Math.min(1, percentage));

        // 3. Calculate which segment of the color array we are in
        //    If we have N colors, we have N-1 segments.
        //    Example: 3 colors (0, 1, 2). 0.5 maps to exactly color[1].
        const scaled = p * (colors.length - 1);

        // 4. Get the index of the start color for this segment
        let index = Math.floor(scaled);

        // 5. Calculate the local percentage (t) within that segment (0 to 1)
        let t = scaled - index;

        // Handle the edge case where percentage is exactly 1.0
        if (index >= colors.length - 1) {
            index = colors.length - 2;
            t = 1;
        }

        const startColor = colors[index];
        const endColor = colors[index + 1];

        // 6. Interpolate R, G, and B individually
        const r = Math.round(startColor[0] + (endColor[0] - startColor[0]) * t);
        const g = Math.round(startColor[1] + (endColor[1] - startColor[1]) * t);
        const b = Math.round(startColor[2] + (endColor[2] - startColor[2]) * t);

        return `rgb(${r}, ${g}, ${b})`;
    },

    generateJWT: (payload, expiresIn = '30d') => {
        return jwt.sign(payload, require('#api/read.js').readMiscData('jwt_secret'), { expiresIn });
    },

    verifyJWT: token => {
        try {
            return jwt.verify(token, require('#api/read.js').readMiscData('jwt_secret'));
        } catch (err) {
            return null;
        }
    },

    formatNumber: (num, decimals = 0, minimal = false) => {
        if (minimal) {
            if (num >= 1_000_000_000) {
                return (num / 1_000_000_000).toFixed(decimals) + 'B';
            } else if (num >= 1_000_000) {
                return (num / 1_000_000).toFixed(decimals) + 'M';
            } else if (num >= 1_000) {
                return (num / 1_000).toFixed(decimals) + 'K';
            }
        }
        return num.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

    sanitizeFtsQuery: input => {
        // Thanks Gemini
        if (!input || !input.trim()) return null;

        return input
            .split(/\s+/) // Split by spaces
            .filter(word => word.length > 0) // Ignore empty spaces
            .map(word => {
                // Escape double quotes in the word itself
                const safeWord = word.replace(/"/g, '""');
                // Wrap in quotes and add wildcard
                return `"${safeWord}"*`;
            })
            .join(' AND '); // Explicit AND ensures all terms must be present
    },

    ordinalSuffix: i => {
        const j = i % 10,
            k = i % 100;
        if (j == 1 && k != 11) {
            return i + 'st';
        }
        if (j == 2 && k != 12) {
            return i + 'nd';
        }
        if (j == 3 && k != 13) {
            return i + 'rd';
        }
        return i + 'th';
    },

    generateSecretKey: (length = 32) => {
        return crypto.randomBytes(length).toString('hex').substring(0, length);
    },

    /**
     * Ensure a value is within a set of valid options.
     * @param {*} value The value
     * @param {*} options A set of valid options
     * @param {*} fallback A value to fall back to if the input value isn't in the valid set
     * @returns A valid value or `null` if fallback isn't defined
     */
    ensureOneOf: (value, options, fallback = null) => {
        if (options.includes(value)) {
            return value;
        }
        return fallback;
    },

    clamp: (num, min, max) => {
        return Math.min(Math.max(num, min), max);
    },

    sha256: data => {
        return crypto.createHash('sha256').update(data).digest('hex');
    },

    ceilToNearest: (num, nearest) => {
        return Math.ceil(num / nearest) * nearest;
    },

    floorToNearest: (num, nearest) => {
        return Math.floor(num / nearest) * nearest;
    },

    roundToNearest: (num, nearest) => {
        return Math.round(num / nearest) * nearest;
    },

    getPlaytimeTooltip: (secs, opts = {}) => {
        const { format = `{time} ({mod})`, speeds = [1, 1.5, 2], include, rounded = false } = opts;
        const lines = [];
        for (const speed of speeds) {
            let mod = 'nomod';
            if (speed > 1) mod = `DT ${speed}x`;
            if (speed < 1) mod = `HT ${speed}x`;
            const time = utils.secsToDuration(secs / speed, rounded, include);
            lines.push(format.replace(`{time}`, time).replace('{mod}', mod));
        }
        return lines.join('\\n');
    }
};

module.exports = utils;
