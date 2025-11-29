const osuApi = require('osu-api-v2-js');

const utils = {

    log: (...args) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}]`, ...args);
    },

    getOsuApiInstance: async () => {
        return await osuApi.API.createAsync(process.env.OSU_CLIENT_ID, process.env.OSU_API_TOKEN);
    },

    rulesetNameToKey: name => {
        switch (name.toLowerCase()) {
            case 'osu!':
            case 'osu':
            case 'osu!standard':
            case 'standard':
            case 'std':
            case 'circles':
                return 'osu';
            case 'osu!taiko':
            case 'taiko':
            case 'drums':
                return 'taiko';
            case 'osu!catch':
            case 'osu!ctb':
            case 'ctb':
            case 'catch':
            case 'fruits':
                return 'fruits';
            case 'osu!mania':
            case 'mania':
            case 'keys':
                return 'mania';
            default:
                return null;
        }
    },

    rulesetKeyToName: (key, full = false) => {
        key = utils.rulesetNameToKey(key) || key.toLowerCase();
        switch (key) {
            case 'osu':
                return full ? 'osu!' : 'osu';
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

    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),

    getRelativeTimestamp: (ts, origin = Date.now()) => {
        const diff = ts - origin;
        const suffix = diff < 0 ? ' ago' : ' from now';
        const format = (value, unit) => {
            return `${value} ${unit}${value !== 1 ? 's' : ''}${suffix}`;
        };
        let absDiff = Math.abs(diff);
        absDiff /= 1000;
        if (absDiff < 60)
            return format(Math.floor(absDiff), 'second');
        absDiff /= 60;
        if (absDiff < 60)
            return format(Math.floor(absDiff), 'minute');
        absDiff /= 60;
        if (absDiff < 24)
            return format(Math.floor(absDiff), 'hour');
        absDiff /= 24;
        if (absDiff < 30)
            return format(Math.floor(absDiff), 'day');
        absDiff /= 7;
        if (absDiff < 4)
            return format(Math.floor(absDiff), 'week');
        absDiff /= 4;
        if (absDiff < 12)
            return format(Math.floor(absDiff), 'month');
        absDiff /= 12;
        return format(Math.floor(absDiff), 'year');
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
                return `rgb(${r}, ${g}, ${b})`;
            }
        }
        return 'rgb(128, 128, 128)';
    },

    secsToDuration: (secs, rounded = false) => {
        if (rounded) {
            if (secs < 60) {
                return `${secs}s`;
            } else if (secs < 3600) {
                const minutes = Math.floor(secs / 60);
                return `${minutes}m`;
            } else if (secs < 86400) {
                const hours = Math.floor(secs / 3600);
                return `${hours}h`;
            } else {
                const days = Math.floor(secs / 86400);
                return `${days}d`;
            }
        } else {
            const days = Math.floor(secs / 86400);
            secs %= 86400;
            const hours = Math.floor(secs / 3600);
            secs %= 3600;
            const minutes = Math.floor(secs / 60);
            secs %= 60;
            let result = '';
            if (days > 0) result += `${days}d `;
            if (hours > 0 || days > 0) result += `${hours}h `;
            if (minutes > 0 || hours > 0 || days > 0) result += `${minutes}m `;
            result += `${secs}s`;
            return result.trim();
        }
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
    }

};

module.exports = utils;