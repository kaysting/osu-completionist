const express = require('express');
const db = require('#db');
const utils = require('#utils');
const { marked } = require('marked');
const ejs = require('ejs');
const fs = require('fs');

const router = express.Router();

const sharedOnSuccess = [
    {
        type: 'boolean',
        name: 'success',
        description: `Equal to \`true\`, indicating the success was successful.`
    }
];
const sharedOnError = [
    {
        type: 'boolean',
        name: 'success',
        description: `Equal to \`false\`, indicating the request was not successful.`
    },
    {
        type: 'Error',
        name: 'error',
        description: `An error object containing more information.`
    }
];

const endpoints = [
    {
        name: 'Get user profile',
        description: `Get osu!complete's cached copy of an osu! user's profile data.`,
        method: 'get',
        path: '/users/{id}/profile',
        params: {
            url: [
                {
                    type: 'integer',
                    name: '{id}',
                    required: true,
                    description: `An osu! user ID.`
                }
            ]
        },
        onSuccess: [
            ...sharedOnSuccess,
            {
                type: 'UserProfile',
                name: 'user',
                description: `The requested user's profile data.`
            }
        ],
        onError: sharedOnError
    }
];

const structs = [
    {
        name: 'Error',
        description: `Describes an error.`,
        properties: [
            {
                type: 'string',
                name: 'code',
                description: `A short error code representing the error that occurred.`
            },
            {
                type: 'string',
                name: 'message',
                description: `A human-readable message describing the error.`
            }
        ]
    },
    {
        name: 'UserProfile',
        description: `Represents an osu! user's profile, as stored by osu!complete.`,
        properties: []
    },
    {
        name: 'Country',
        description: `Represents a country.`,
        properties: []
    },
    {
        name: 'Team',
        description: `Represents an osu! team.`,
        properties: []
    }
];

router.get('/', async (req, res) => {
    let key = db.prepare(`SELECT api_key FROM users WHERE id = ?`).get(req?.me?.id)?.api_key;
    const text = fs.readFileSync('views/markdown/apiDocs.md', 'utf-8');
    const md = ejs.render(text, { key, endpoints, structs });
    const html = await marked.parse(md);
    res.renderPage('raw', {
        title: 'API Docs',
        meta: {
            title: 'API Documentation',
            description: 'Learn how to use the osu!complete API!'
        },
        html
    });
});

router.get('/regenerate', (req, res) => {
    if (req.me) {
        const newKey = utils.generateSecretKey(32);
        db.prepare(`UPDATE users SET api_key = ? WHERE id = ?`).run(newKey, req.me.id);
    }
    res.redirect('/api');
});

module.exports = router;