const env = require('#env');
const express = require('express');
const axios = require('axios');
const utils = require('#utils');
const updaterHelpers = require('#api/write.js');
const { log } = utils;
const db = require('#db');

const router = express.Router();

router.get('/login', (req, res) => {
    res.redirect(
        `https://osu.ppy.sh/oauth/authorize?client_id=${env.OSU_CLIENT_ID}&redirect_uri=${encodeURIComponent(env.OSU_AUTH_REDIRECT_URI)}&response_type=code&scope=identify`
    );
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
        formData.append('client_id', env.OSU_CLIENT_ID);
        formData.append('client_secret', env.OSU_CLIENT_SECRET);
        formData.append('code', code);
        formData.append('grant_type', 'authorization_code');
        formData.append('redirect_uri', env.OSU_AUTH_REDIRECT_URI);
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
        // Get existing user entry and queue entry
        const existingUserEntry = db.prepare('SELECT * FROM users WHERE id = ?').get(user.data.id);
        const existingQueueEntry = db.prepare('SELECT * FROM user_import_queue WHERE user_id = ?').get(user.data.id);
        // Save/update user data to db
        const userEntry = await updaterHelpers.updateUserProfile(user.data.id);
        if (!userEntry) {
            return res.renderError(
                401,
                'Failed to sign in',
                `Your osu! sign in attempt failed. This might be because you cancelled it, or your account is banned, preventing us from fetching your account info. Please try again.`
            );
        }
        if (!existingUserEntry) {
            // Queue user if they're new
            await updaterHelpers.queueUserForImport(user.data.id);
            const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
            utils.log(`${user.data.username} registered as a new user!`);
            await utils.sendDiscordMessage(env.USER_FEED_DISCORD_CHANNEL_ID, {
                embeds: [
                    {
                        author: {
                            name: userEntry.name,
                            icon_url: userEntry.avatar_url,
                            url: `${env.BASE_URL}/u/${userEntry.id}`
                        },
                        title: `Registered as our ${utils.ordinalSuffix(userCount)} user!`,
                        color: 0xa3f5a3
                    }
                ]
            });
        } else if (!userEntry?.last_import_time && !existingQueueEntry) {
            // Queue user if they haven't been imported and they aren't queued
            // This can happen in some edge cases
            await updaterHelpers.queueUserForImport(user.data.id);
        } else {
            utils.log(`${user.data.username} logged in on a new device`);
        }
        // Set JWT cookie
        const jwt = utils.generateJWT({ id: user.data.id });
        res.cookie('token', jwt, {
            httpOnly: true,
            secure: env.HTTPS,
            expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365)
        });
        // Redirect to saved path or user profile
        // Only redirect to saved path if it's something the user
        // was in the middle of
        let redirectPath = `/u/${user.data.id}`;
        if ((req.session?.lastUrl || '').match(/^\/api/)) {
            redirectPath = req.session.lastUrl;
        }
        res.redirect(redirectPath);
    } catch (error) {
        console.error('OAuth callback error:', error);
        return res.redirect('/auth/login');
    }
});

router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect(req.session?.lastUrl || '/');
});

module.exports = router;
