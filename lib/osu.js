/*

The existing osu API libraries for Node were giving me issues, so I decided
to put one together myself according to the docs with the assistance
of Gemini. This file covers all GET endpoints and expects credentials
to be provided via the OSU_CLIENT_ID and OSU_CLIENT_SECRET environment variables.

osu! API Documentation: https://osu.ppy.sh/docs

*/

const env = require('#env');
const axios = require('axios');

let baseUrl = 'https://osu.ppy.sh/api/v2';
let token = '';
let expireTime = 0;
let tokenPromise = null;
let lastRequestTime = Date.now();
let rateLimitRemaining = 1200;
const MAX_RATE_LIMIT = 1200;
const MAX_REQUESTS_PER_SECOND = 20;
const MIN_SAFE_LIMIT_REMAINING = 200;

function getLimitRemainingNow() {
    const now = Date.now();
    const msSinceLastRequest = now - lastRequestTime;
    return Math.min(MAX_RATE_LIMIT, rateLimitRemaining + Math.floor((msSinceLastRequest / 1000) * MAX_REQUESTS_PER_SECOND));
}

/**
 * Returns a valid oauth token, refreshing it if necessary.
 * @returns {Promise<string>} The access token.
 */
async function getToken() {
    const now = Date.now();

    if (now < expireTime && token) {
        return token;
    }

    if (tokenPromise) {
        return tokenPromise;
    }

    tokenPromise = (async () => {
        try {
            const formData = new URLSearchParams();
            formData.append('client_id', env.OSU_CLIENT_ID);
            formData.append('client_secret', env.OSU_CLIENT_SECRET);
            formData.append('grant_type', 'client_credentials');
            formData.append('scope', 'public');

            const res = await axios.post('https://osu.ppy.sh/oauth/token', formData);

            token = res.data.access_token;
            expireTime = now + (res.data.expires_in * 1000) - (60 * 1000);

            return token;
        } catch (error) {
            const e = new Error(`Error getting token from osu! API: ${error}`);
            e.data = error?.response?.data || null;
            e.status = error?.response?.status || null;
            throw e;
        } finally {
            tokenPromise = null;
        }
    })();

    return tokenPromise;
}

/**
 * Helper function to make GET requests to the osu! API.
 * @param {string} endpoint - The API endpoint (e.g., '/users/1').
 * @param {Object} [params] - Query string parameters.
 * @returns {Promise<any>} The response data.
 */
const makeGetRequest = async (endpoint, params = {}) => {
    const token = await getToken();
    let waitTime = 3000;
    let maxRetries = 10;
    let tries = 0;
    while (true) {
        try {
            tries++;
            // Throttle if limit remaining is too low
            const limitRemainingNow = getLimitRemainingNow();
            if (limitRemainingNow < MIN_SAFE_LIMIT_REMAINING) {
                const waitMs = Math.ceil((MIN_SAFE_LIMIT_REMAINING - limitRemainingNow) / MAX_REQUESTS_PER_SECOND * 1000);
                //console.log(`[osu.js] Throttling for ${waitMs}ms before GET ${endpoint}...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
            // Pessimistically pay for the request
            rateLimitRemaining -= MIN_SAFE_LIMIT_REMAINING;
            // Make request
            const res = await axios.get(baseUrl + endpoint, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                timeout: 1000 * 15,
                params: params
            });
            // Update rate limit info
            lastRequestTime = Date.now();
            const limitRemainingFromHeader = parseInt(res.headers['x-ratelimit-remaining']);
            if (!isNaN(limitRemainingFromHeader)) {
                rateLimitRemaining = limitRemainingFromHeader;
            } else {
                console.log(`[osu.js] Warning: Missing X-RateLimit-Remaining header on GET ${endpoint}`);
            }
            // Return data
            return res.data;
        } catch (error) {
            const status = error?.response?.status || null;
            // If status is undefined (network errors), 429 (rate limit), or 500 (server error),
            // wait and retry using exponential backoff and jitter
            // Otherwise, attach data and status to a new error and throw it
            if ((!status || status === 429 || status >= 500) && tries < maxRetries) {
                console.log(`[osu.js] ${status || error.code} on GET ${endpoint}, trying again (${tries + 1}/${maxRetries}) in ${Math.round(waitTime)}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                waitTime = Math.min((waitTime * 2) + (0.2 * waitTime * Math.random()), 60 * 1000);
            } else {
                const e = new Error(`Error making GET request to osu! API ${endpoint}: ${error}`);
                e.data = error?.response?.data || null;
                e.status = status;
                throw e;
            }
        }
    }
};

module.exports = {

    getToken,

    // --- Beatmap Packs ---

    /**
     * Returns a list of beatmap packs.
     * @param {Object} [params]
     * @param {string} [params.type] - BeatmapPackType (standard, featured, tournament, etc).
     * @param {string} [params.cursor_string] - Pagination cursor.
     * @returns {Promise<Object>} List of beatmap packs.
     */
    getBeatmapPacks: async (params) => {
        return await makeGetRequest('/beatmaps/packs', params);
    },

    /**
     * Gets the beatmap pack for the specified tag.
     * @param {string} tag - The tag of the beatmap pack.
     * @param {Object} [params]
     * @param {number} [params.legacy_only] - 0 or 1. Whether to exclude lazer scores.
     * @returns {Promise<Object>} The beatmap pack details.
     */
    getBeatmapPack: async (tag, params) => {
        return await makeGetRequest(`/beatmaps/packs/${tag}`, params);
    },

    // --- Beatmaps ---

    /**
     * Look up a beatmap by ID, checksum, or filename.
     * @param {Object} params
     * @param {string} [params.checksum] - A beatmap checksum.
     * @param {string} [params.filename] - A filename to lookup.
     * @param {number} [params.id] - A beatmap ID to lookup.
     * @returns {Promise<Object>} The beatmap.
     */
    lookupBeatmap: async (params) => {
        return await makeGetRequest('/beatmaps/lookup', params);
    },

    /**
     * Returns a user's score on a specific beatmap.
     * @param {number} beatmapId - ID of the beatmap.
     * @param {number} userId - ID of the user.
     * @param {Object} [params]
     * @param {string} [params.mode] - The ruleset to get scores for.
     * @param {string} [params.mods] - Matching mods.
     * @param {number} [params.legacy_only] - 0 or 1.
     * @returns {Promise<Object>} The score.
     */
    getBeatmapUserScore: async (beatmapId, userId, params) => {
        return await makeGetRequest(`/beatmaps/${beatmapId}/scores/users/${userId}`, params);
    },

    /**
     * Returns all scores for a user on a specific beatmap.
     * @param {number} beatmapId - ID of the beatmap.
     * @param {number} userId - ID of the user.
     * @param {Object} [params]
     * @param {string} [params.mode] - Deprecated, use ruleset.
     * @param {string} [params.ruleset] - The ruleset to get scores for.
     * @param {number} [params.legacy_only] - 0 or 1.
     * @returns {Promise<Object>} List of scores.
     */
    getBeatmapUserScores: async (beatmapId, userId, params) => {
        return await makeGetRequest(`/beatmaps/${beatmapId}/scores/users/${userId}/all`, params);
    },

    /**
     * Returns the top scores for a beatmap.
     * @param {number} beatmapId - ID of the beatmap.
     * @param {Object} [params]
     * @param {string} [params.mode] - Ruleset to get scores for.
     * @param {string} [params.mods] - Matching mods.
     * @param {string} [params.type] - Beatmap score ranking type.
     * @param {number} [params.legacy_only] - 0 or 1.
     * @returns {Promise<Object>} List of scores.
     */
    getBeatmapScores: async (beatmapId, params) => {
        return await makeGetRequest(`/beatmaps/${beatmapId}/scores`, params);
    },

    /**
     * Returns a list of beatmaps.
     * @param {Object} [params]
     * @param {number[]} [params.ids] - Array of beatmap IDs.
     * @returns {Promise<Object>} List of beatmaps.
     */
    getBeatmaps: async (params) => {
        return await makeGetRequest('/beatmaps', params);
    },

    /**
     * Gets beatmap data for the specified beatmap ID.
     * @param {number} beatmapId - The ID of the beatmap.
     * @returns {Promise<Object>} The beatmap extended object.
     */
    getBeatmap: async (beatmapId) => {
        return await makeGetRequest(`/beatmaps/${beatmapId}`);
    },

    // --- Beatmapset Discussions ---

    /**
     * Returns the posts of beatmapset discussions.
     * @param {Object} [params]
     * @param {number} [params.beatmapset_discussion_id]
     * @param {number} [params.limit]
     * @param {number} [params.page]
     * @param {string} [params.sort] - 'id_desc' or 'id_asc'.
     * @param {string[]} [params.types] - 'first', 'reply', 'system'.
     * @param {number} [params.user] - User ID.
     * @returns {Promise<Object>} Discussion posts.
     */
    getBeatmapsetDiscussionPosts: async (params) => {
        return await makeGetRequest('/beatmapsets/discussions/posts', params);
    },

    /**
     * Returns the votes given to beatmapset discussions.
     * @param {Object} [params]
     * @param {number} [params.beatmapset_discussion_id]
     * @param {number} [params.limit]
     * @param {number} [params.page]
     * @param {number} [params.receiver] - User ID receiving votes.
     * @param {number} [params.score] - 1 for upvote, -1 for downvote.
     * @param {string} [params.sort] - 'id_desc' or 'id_asc'.
     * @param {number} [params.user] - User ID giving votes.
     * @returns {Promise<Object>} Discussion votes.
     */
    getBeatmapsetDiscussionVotes: async (params) => {
        return await makeGetRequest('/beatmapsets/discussions/votes', params);
    },

    /**
     * Returns a list of beatmapset discussions.
     * @param {Object} [params]
     * @param {number} [params.beatmap_id]
     * @param {number} [params.beatmapset_id]
     * @param {string} [params.beatmapset_status] - 'all', 'ranked', 'qualified', 'disqualified', 'never_qualified'.
     * @param {number} [params.limit]
     * @param {string[]} [params.message_types] - 'suggestion', 'problem', 'mapper_note', 'praise', 'hype', 'review'.
     * @param {boolean} [params.only_unresolved]
     * @param {number} [params.page]
     * @param {string} [params.sort]
     * @param {number} [params.user]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} List of discussions.
     */
    getBeatmapsetDiscussions: async (params) => {
        return await makeGetRequest('/beatmapsets/discussions', params);
    },

    // --- Beatmapsets ---

    /**
     * Search for beatmapsets.
     * @param {Object} [params]
     * @param {string} [params.q] Search query.
     * @param {string} [params.cursor_string]
     * @param {string} [params.s] Sort order.
     * @param {boolean} [params.nsfw]
     * @returns {Promise<Object>} Search results.
     */
    searchBeatmapsets: async (params) => {
        return await makeGetRequest('/beatmapsets/search', params);
    },

    /**
     * Lookup a beatmapset by ID or beatmap ID.
     * @param {Object} params
     * @param {number} [params.beatmap_id]
     * @param {number} [params.beatmapset_id]
     * @returns {Promise<Object>} The beatmapset.
     */
    lookupBeatmapset: async (params) => {
        return await makeGetRequest('/beatmapsets/lookup', params);
    },

    /**
     * Gets beatmapset data.
     * @param {number} beatmapsetId - The ID of the beatmapset.
     * @returns {Promise<Object>} The beatmapset extended object.
     */
    getBeatmapset: async (beatmapsetId) => {
        return await makeGetRequest(`/beatmapsets/${beatmapsetId}`);
    },

    /**
     * Returns a list of events for beatmapsets (nominations, qualifies, etc).
     * @param {Object} [params]
     * @param {string[]} [params.types]
     * @param {string} [params.sort]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} List of events.
     */
    getBeatmapsetEvents: async (params) => {
        return await makeGetRequest('/beatmapsets/events', params);
    },

    // --- Changelog ---

    /**
     * Returns details of the specified build.
     * @param {string} stream - Update stream name (e.g., 'stable40', 'lazer').
     * @param {string} build - Build version.
     * @returns {Promise<Object>} Build details.
     */
    getChangelogBuild: async (stream, build) => {
        return await makeGetRequest(`/changelog/${stream}/${build}`);
    },

    /**
     * Returns a listing of update streams, builds, and changelog entries.
     * @param {Object} [params]
     * @param {string} [params.from] - Minimum build version.
     * @param {number} [params.max_id] - Maximum build ID.
     * @param {string} [params.stream] - Stream name.
     * @param {string} [params.to] - Maximum build version.
     * @param {string[]} [params.message_formats] - 'html', 'markdown'.
     * @returns {Promise<Object>} Changelog listing.
     */
    getChangelogListing: async (params) => {
        return await makeGetRequest('/changelog', params);
    },

    /**
     * Returns details of the specified build by looking up version, stream, or ID.
     * @param {string} changelog - Build version, stream name, or build ID.
     * @param {Object} [params]
     * @param {string} [params.key] - 'id' if querying by ID, unset otherwise.
     * @param {string[]} [params.message_formats]
     * @returns {Promise<Object>} Build details.
     */
    lookupChangelogBuild: async (changelog, params) => {
        return await makeGetRequest(`/changelog/${changelog}`, params);
    },

    // --- Comments ---

    /**
     * Returns a list of comments and their replies up to 2 levels deep.
     * @param {Object} [params]
     * @param {string} [params.after]
     * @param {string} [params.commentable_type] - e.g., 'news_post', 'beatmapset'.
     * @param {number} [params.commentable_id]
     * @param {string} [params.cursor]
     * @param {number} [params.parent_id]
     * @param {string} [params.sort] - 'new', 'old', 'top'.
     * @returns {Promise<Object>} Comment bundle.
     */
    getComments: async (params) => {
        return await makeGetRequest('/comments', params);
    },

    /**
     * Gets a comment and its replies up to 2 levels deep.
     * @param {number} commentId - The ID of the comment.
     * @returns {Promise<Object>} Comment bundle.
     */
    getComment: async (commentId) => {
        return await makeGetRequest(`/comments/${commentId}`);
    },

    // --- Events ---

    /**
     * Returns a collection of Events (achievements, beatmap playcounts, etc).
     * @param {Object} [params]
     * @param {string} [params.sort]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} List of events.
     */
    getEvents: async (params) => {
        return await makeGetRequest('/events', params);
    },

    // --- Forums ---

    /**
     * Get a sorted list of topics, optionally from a specific forum.
     * @param {Object} [params]
     * @param {number} [params.forum_id]
     * @param {string} [params.sort] - 'new', 'old'.
     * @param {number} [params.limit]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} List of topics.
     */
    getForumTopics: async (params) => {
        return await makeGetRequest('/forums/topics', params);
    },

    /**
     * Get a topic and its posts.
     * @param {number} topicId - The ID of the topic.
     * @param {Object} [params]
     * @param {string} [params.sort] - 'id_asc', 'id_desc'.
     * @param {number} [params.limit]
     * @param {number} [params.start]
     * @param {number} [params.end]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} Topic details and posts.
     */
    getForumTopic: async (topicId, params) => {
        return await makeGetRequest(`/forums/topics/${topicId}`, params);
    },

    /**
     * Get top-level forums and their subforums.
     * @returns {Promise<Object>} List of forums.
     */
    getForums: async () => {
        return await makeGetRequest('/forums');
    },

    /**
     * Get a forum by ID, its pinned topics, recent topics, and subforums.
     * @param {number} forumId - The ID of the forum.
     * @returns {Promise<Object>} Forum details.
     */
    getForum: async (forumId) => {
        return await makeGetRequest(`/forums/${forumId}`);
    },

    // --- Matches ---

    /**
     * Returns a list of matches.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @param {string} [params.sort]
     * @param {boolean} [params.active]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} List of matches.
     */
    getMatches: async (params) => {
        return await makeGetRequest('/matches', params);
    },

    /**
     * Returns details of the specified match.
     * @param {number} matchId - The ID of the match.
     * @param {Object} [params]
     * @param {number} [params.before] - Get events before this ID.
     * @param {number} [params.after] - Get events after this ID.
     * @param {number} [params.limit]
     * @returns {Promise<Object>} Match details.
     */
    getMatch: async (matchId, params) => {
        return await makeGetRequest(`/matches/${matchId}`, params);
    },

    // --- Multiplayer ---

    /**
     * Returns a list of scores for a specified playlist item in a room.
     * @param {number} roomId - Room ID.
     * @param {number} playlistId - Playlist item ID.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @param {string} [params.sort]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} List of scores.
     */
    getRoomPlaylistScores: async (roomId, playlistId, params) => {
        return await makeGetRequest(`/rooms/${roomId}/playlist/${playlistId}/scores`, params);
    },

    /**
     * Returns a list of multiplayer rooms.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @param {string} [params.mode] - 'active', 'all', 'ended', etc.
     * @param {string} [params.season_id]
     * @param {string} [params.sort]
     * @param {string} [params.type_group]
     * @returns {Promise<Object>} List of rooms.
     */
    getRooms: async (params) => {
        return await makeGetRequest('/rooms', params);
    },

    /**
     * Gets details of a multiplayer room.
     * @param {number} roomId - Room ID.
     * @returns {Promise<Object>} Room details.
     */
    getRoom: async (roomId) => {
        return await makeGetRequest(`/rooms/${roomId}`);
    },

    /**
     * Gets the leaderboard for a multiplayer room.
     * @param {number} roomId - Room ID.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @returns {Promise<Object>} Room leaderboard.
     */
    getRoomLeaderboard: async (roomId, params) => {
        return await makeGetRequest(`/rooms/${roomId}/leaderboard`, params);
    },

    /**
     * Gets events for a multiplayer room.
     * @param {number} roomId - Room ID.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @param {string} [params.sort]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} List of room events.
     */
    getRoomEvents: async (roomId, params) => {
        return await makeGetRequest(`/rooms/${roomId}/events`, params);
    },

    // --- News ---

    /**
     * Returns a list of news posts.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @param {number} [params.year]
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} News listing.
     */
    getNews: async (params) => {
        return await makeGetRequest('/news', params);
    },

    /**
     * Returns details of a specific news post.
     * @param {string} newsIdOrSlug - The ID or Slug of the news post.
     * @param {Object} [params]
     * @param {string} [params.key] - 'id' if querying by ID, unset for slug.
     * @returns {Promise<Object>} News post details.
     */
    getNewsPost: async (newsIdOrSlug, params) => {
        return await makeGetRequest(`/news/${newsIdOrSlug}`, params);
    },

    // --- Rankings ---

    /**
     * Gets the Kudosu ranking.
     * @param {Object} [params]
     * @param {number} [params.page]
     * @returns {Promise<Object>} Kudosu rankings.
     */
    getKudosuRanking: async (params) => {
        return await makeGetRequest('/rankings/kudosu', params);
    },

    /**
     * Gets the ranking for a specific mode and type.
     * @param {string} mode - 'osu', 'taiko', 'fruits', 'mania'.
     * @param {string} type - 'performance', 'score', 'country', 'charts'.
     * @param {Object} [params]
     * @param {string} [params.country] - Country code (filter).
     * @param {string} [params.cursor]
     * @param {string} [params.filter] - 'all' or 'friends'.
     * @param {string} [params.spotlight] - Spotlight ID.
     * @param {string} [params.variant] - '4k', '7k' (for mania).
     * @returns {Promise<Object>} Ranking data.
     */
    getRanking: async (mode, type, params) => {
        return await makeGetRequest(`/rankings/${mode}/${type}`, params);
    },

    /**
     * Gets the list of spotlights.
     * @returns {Promise<Object>} List of spotlights.
     */
    getSpotlights: async () => {
        return await makeGetRequest('/spotlights');
    },

    // --- Seasonal Backgrounds ---

    /**
     * Returns the seasonal backgrounds.
     * @returns {Promise<Object>} Seasonal backgrounds.
     */
    getSeasonalBackgrounds: async () => {
        return await makeGetRequest('/seasonal-backgrounds');
    },

    // --- Scores ---

    /**
     * Returns a list of scores (generic).
     * @param {Object} [params]
     * @param {string} [params.ruleset] - The ruleset to get scores for.
     * @param {string} [params.cursor_string]
     * @returns {Promise<Object>} List of scores.
     */
    getScores: async (params) => {
        return await makeGetRequest('/scores', params);
    },

    // --- Tags ---

    /**
     * Returns a list of tags.
     * @returns {Promise<Object>} Tags.
     */
    getTags: async () => {
        return await makeGetRequest('/tags');
    },

    // --- Users ---

    /**
     * Searches for a user to get their ID and other details.
     * @param {Object} params
     * @param {string} [params.key] - id or username.
     * @returns {Promise<Object>} User details.
     */
    lookupUser: async (params) => {
        return await makeGetRequest('/users/lookup', params);
    },

    /**
     * Returns kudosu history for a user.
     * @param {number} userId - User ID.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @param {number} [params.offset]
     * @returns {Promise<Object[]>} Kudosu history.
     */
    getUserKudosu: async (userId, params) => {
        return await makeGetRequest(`/users/${userId}/kudosu`, params);
    },

    /**
     * Returns a user's scores (best, firsts, recent).
     * @param {number} userId - User ID.
     * @param {string} type - 'best', 'firsts', 'recent'.
     * @param {Object} [params]
     * @param {number} [params.include_fails] - 1 to include, 0 to exclude.
     * @param {string} [params.mode]
     * @param {number} [params.limit]
     * @param {number} [params.offset]
     * @param {number} [params.legacy_only] - 0 or 1.
     * @returns {Promise<Object[]>} List of scores.
     */
    getUserScores: async (userId, type, params) => {
        return await makeGetRequest(`/users/${userId}/scores/${type}`, params);
    },

    /**
     * Returns a user's beatmapsets (favourite, graveyard, loved, ranked, etc).
     * @param {number} userId - User ID.
     * @param {string} type - 'favourite', 'graveyard', 'loved', 'ranked', 'pending', etc.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @param {number} [params.offset]
     * @returns {Promise<Object[]>} List of beatmapsets.
     */
    getUserBeatmaps: async (userId, type, params) => {
        return await makeGetRequest(`/users/${userId}/beatmapsets/${type}`, params);
    },

    /**
     * Returns a user's recent activity.
     * @param {number} userId - User ID.
     * @param {Object} [params]
     * @param {number} [params.limit]
     * @param {number} [params.offset]
     * @returns {Promise<Object[]>} List of activities.
     */
    getUserRecentActivity: async (userId, params) => {
        return await makeGetRequest(`/users/${userId}/recent_activity`, params);
    },

    /**
     * Searches for beatmaps a user has passed.
     * @param {number} userId - User ID.
     * @param {Object} [params]
     * @param {number[]} [params.beatmapset_ids] - Array of beatmapset IDs.
     * @param {boolean} [params.exclude_converts]
     * @param {boolean} [params.is_legacy]
     * @param {boolean} [params.no_diff_reduction]
     * @param {number} [params.ruleset_id]
     * @returns {Promise<Object[]>} List of beatmaps.
     */
    getUserBeatmapsPassed: async (userId, params) => {
        return await makeGetRequest(`/users/${userId}/beatmaps-passed`, params);
    },

    /**
     * Returns details of the specified user.
     * @param {number} userId - User ID or @username.
     * @param {string} [mode] - specific mode (osu, taiko, etc) or empty for default.
     * @param {Object} [params]
     * @param {string} [params.key] - 'id' or 'username'.
     * @returns {Promise<Object>} User details.
     */
    getUser: async (userId, mode = '', params = {}) => {
        return await makeGetRequest(`/users/${userId}/${mode}`, params);
    },

    /**
     * Returns a list of users given their IDs.
     * @param {Object} [params]
     * @param {number[]} [params.ids] - Array of User IDs.
     * @returns {Promise<Object>} List of users.
     */
    getUsers: async (params) => {
        return await makeGetRequest('/users', params);
    },

    // --- Wiki ---

    /**
     * Returns a wiki page.
     * @param {string} locale - Two-letter language code (e.g., 'en').
     * @param {string} path - Path of the wiki page.
     * @returns {Promise<Object>} Wiki page details.
     */
    getWikiPage: async (locale, path) => {
        return await makeGetRequest(`/wiki/${locale}/${path}`);
    },

    // --- Search ---

    /**
     * Searches users and wiki pages.
     * @param {Object} [params]
     * @param {string} [params.mode] - 'all', 'user', 'wiki_page'.
     * @param {string} [params.query] - Search keyword.
     * @param {number} [params.page]
     * @returns {Promise<Object>} Search results.
     */
    search: async (params) => {
        return await makeGetRequest('/search', params);
    }
};