const express = require('express');
const db = require('../helpers/db');

const router = express.Router();

router.get('/', (req, res) => {
    let key = null;
    if (req.me) {
        key = db.prepare(`SELECT api_key FROM users WHERE id = ?`).get(req.me.id).api_key;
    }
    res.renderPage('apiDocs', {
        key
    });
});

router.get('/regen', (req, res) => {

});

module.exports = router;