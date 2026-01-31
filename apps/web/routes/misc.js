const express = require('express');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const router = express.Router();

router.use('/tos', (req, res) => {
    res.renderPage('raw', {
        html: marked.parse(fs.readFileSync(path.join(__dirname, '../views/markdown/tos.md'), 'utf-8')),
        title: 'Terms of Service',
        meta: {
            title: 'Terms of Service',
            description: 'View the osu!complete terms of service.'
        }
    });
});
router.use('/privacy', (req, res) => {
    res.renderPage('raw', {
        html: marked.parse(fs.readFileSync(path.join(__dirname, '../views/markdown/privacy.md'), 'utf-8')),
        title: 'Privacy Policy',
        meta: {
            title: 'Privacy Policy',
            description: 'View the osu!complete privacy policy.'
        }
    });
});
router.use('/faq', (req, res) => {
    res.renderPage('raw', {
        html: marked.parse(fs.readFileSync(path.join(__dirname, '../views/markdown/faq.md'), 'utf-8')),
        title: 'FAQ',
        meta: {
            title: 'FAQ',
            description: 'View our frequently asked questions.'
        }
    });
});
router.use('/changelog', (req, res) => {
    res.renderPage('raw', {
        html: marked.parse(`# Changelog\n\n${fs.readFileSync(path.join(__dirname, '../views/markdown/changelog.md'), 'utf-8')}`),
        title: 'Changelog',
        meta: {
            title: 'Changelog',
            description: 'Check out the changelog to learn about recent significant changes.'
        }
    });
});

module.exports = router;