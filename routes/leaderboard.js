const express = require('express');
const db = require('../db');

const { rulesetNameToKey, rulesetKeyToName } = require('../utils.js');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect(`/leaderboard/osu/ranked`);
});

router.get('/:mode', (req, res) => {
    res.redirect(`/leaderboard/${req.params.mode}/ranked`);
});

router.get('/:mode/:includes', (req, res) => {
    // Get params
    const page = parseInt(req.query.p) || 1;
    const mode = req.params.mode || 'osu';
    const includes = req.params.includes?.split('-') || ['ranked'];
    const includeConverts = includes.includes('converts') ? 1 : 0;
    const includeLoved = includes.includes('loved') ? 1 : 0;
    const limit = 50;
    const offset = (page - 1) * limit;
    // Check params
    const modeKey = rulesetNameToKey(mode);
    if (!modeKey) {
        return res.redirect('/leaderboard/osu/ranked-loved');
    }
    // Get leaderboard entries
    const entries = db.prepare(
        `SELECT
            u.id, u.name, u.avatar_url, u.banner_url, us.count,
            c.name AS country_name, u.country_code, u.team_name, u.team_flag_url
         FROM users u
         JOIN user_stats us ON u.id = us.user_id
         JOIN country_names c ON u.country_code = c.code
         WHERE us.mode = ? AND us.includes_loved = ? AND us.includes_converts = ?
         ORDER BY us.count DESC
         LIMIT ? OFFSET ?`
    ).all(modeKey, includeLoved, includeConverts, limit, offset);
    // Get total number of beatmaps
    const totalMapCount = db.prepare(
        `SELECT count FROM beatmap_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(modeKey, includeLoved, includeConverts).count;
    // Get total number of players
    const totalPlayers = db.prepare(
        `SELECT COUNT(*) AS total FROM user_stats
         WHERE mode = ? AND includes_loved = ? AND includes_converts = ?`
    ).get(modeKey, includeLoved, includeConverts).total;
    // Calculate total page count
    const maxPages = Math.ceil(totalPlayers / limit);
    // Determine what page numbers to show
    // Always show first and last page, and 2 pages before and after current page
    const pagesToShow = [];
    for (let i = 1; i <= maxPages; i++) {
        if (i === 1 || i === maxPages || (i >= page - 1 && i <= page + 1)) {
            pagesToShow.push(i);
        } else if (pagesToShow[pagesToShow.length - 1] !== '...') {
            pagesToShow.push('...');
        }
    }
    // Compile data
    const leaderboard = entries.map((entry, index) => ({
        rank: offset + index + 1,
        id: entry.id,
        name: entry.name,
        avatar: entry.avatar_url,
        banner: entry.banner_url,
        country: {
            code: entry.country_code,
            name: entry.country_name
        },
        team: {
            name: entry.team_name,
            flag: entry.team_flag_url
        },
        completed: entry.count,
        total: totalMapCount,
        percentage: totalMapCount > 0 ? ((entry.count / totalMapCount) * 100).toFixed(2) : '0.00'
    }));
    // Render
    const modeNameFull = rulesetKeyToName(modeKey, true);
    res.render('layout', {
        title: `${modeNameFull} leaderboard`,
        meta: {
            title: `${modeNameFull} completionist leaderboard`,
            description: `View the players who have passed the most ${modeNameFull} beatmaps!`
        },
        page: 'leaderboard',
        settings: {
            modeKey, mode, includes, basePath: '/leaderboard'
        },
        pagination: {
            current: page, nav: pagesToShow, basePath: `/leaderboard/${mode}/${includes.join('-')}`
        },
        leaderboard: leaderboard,
        me: req.me
    });
});

module.exports = router;