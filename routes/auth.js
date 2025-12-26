require('dotenv').config();
const express = require('express');
const axios = require('axios');
const utils = require('../helpers/utils');
const updaterHelpers = require('../helpers/updaterHelpers');
const { log } = utils;
const db = require('../helpers/db');

const router = express.Router();

router.get('/login', (req, res) => {
    res.redirect(`https://osu.ppy.sh/oauth/authorize?client_id=${process.env.OSU_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.OSU_AUTH_REDIRECT_URI)}&response_type=code&scope=identify`);
});

router.get('/callback', async (req, res) => {
    try {
        // Get and check code
        const code = req.query.code;
        if (!code) {
            return res.redirect('/auth/login');
        }
        // Build form data
        const formData = new URLSearchParams();
        formData.append('client_id', process.env.OSU_CLIENT_ID);
        formData.append('client_secret', process.env.OSU_CLIENT_SECRET);
        formData.append('code', code);
        formData.append('grant_type', 'authorization_code');
        formData.append('redirect_uri', process.env.OSU_AUTH_REDIRECT_URI);
        // Get user auth token
        const tokenRes = await axios.post('https://osu.ppy.sh/oauth/token', formData);
        const token = tokenRes.data.access_token;
        // Request user data
        const user = await axios.get('https://osu.ppy.sh/api/v2/me', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        // Check user data
        if (!user?.data?.username) {
            return res.redirect('/auth/login');
        }
        log(`User ${user.data.username} (${user.data.id}) logged in via OAuth`);
        // Save user data to db
        const wasProfileUpdated = await updaterHelpers.updateUserProfile(user.data.id, user.data);
        if (wasProfileUpdated === null) {
            return res.redirect('/auth/login');
        }
        // Queue user if they're new
        const userEntry = db.prepare('SELECT * FROM users WHERE id = ?').get(user.data.id);
        if (!userEntry) {
            await updaterHelpers.queueUserForImport(user.data.id);
        }
        // Set JWT cookie
        const jwt = utils.generateJWT({ id: user.data.id });
        res.cookie('token', jwt, {
            httpOnly: true,
            secure: true,
            expires: new Date(Date.now() + (1000 * 60 * 60 * 24 * 365))
        });
        // Redirect to user page
        res.redirect(`/u/${user.data.id}`);
    } catch (error) {
        console.error('OAuth callback error:', error);
        return res.redirect('/auth/login');
    }
});

router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/');
});

module.exports = router;