const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect('https://discord.gg/fNSnMG7S3C');
});

router.post('/interactions', (req, res, next) => {
    // Handle Discord bot interactions here later
    next();
});

module.exports = router;