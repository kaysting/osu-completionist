const crypto = require('crypto');
const express = require('express');
const env = require('#env');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect('https://discord.gg/fNSnMG7S3C');
});

const PUBLIC_KEY = env.DISCORD_BOT_PUBLIC_KEY;

const verifyDiscordRequest = (req, res, next) => {
    const signature = req.get('X-Signature-Ed25519');
    const timestamp = req.get('X-Signature-Timestamp');

    const body = req.rawBody;

    if (!signature || !timestamp || !body) {
        return res.status(401).end('invalid request signature');
    }

    try {
        // Prepare public key
        // Header hex: Sequence + OID for Ed25519 (1.3.101.112)
        const derHeader = Buffer.from('302a300506032b6570032100', 'hex');
        const publicKeyBuffer = Buffer.from(PUBLIC_KEY, 'hex');
        const derKey = Buffer.concat([derHeader, publicKeyBuffer]);

        // Import the key as a standard Node.js KeyObject
        const key = crypto.createPublicKey({
            key: derKey,
            format: 'der',
            type: 'spki'
        });

        // Verify
        // Algorithm is null because the key type (Ed25519) dictates the algorithm
        const isVerified = crypto.verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));

        if (!isVerified) {
            return res.status(401).end('invalid request signature');
        }

        next();
    } catch (error) {
        console.error(error);
        return res.status(401).end('invalid request signature');
    }
};

router.post('/interactions', verifyDiscordRequest, (req, res, next) => {
    const type = req.body.type;

    switch (type) {
        // Ping event
        case 1: {
            return res.json({ type: 1 });
        }
    }
});

module.exports = router;
