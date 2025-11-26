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
    }

};

module.exports = utils;