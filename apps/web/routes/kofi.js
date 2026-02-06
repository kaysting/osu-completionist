const env = require('#env');
const utils = require('#utils');
const express = require('express');
const db = require('#db');

const router = express.Router();

router.get('/', (req, res) => {
    res.redirect('https://ko-fi.com/kaysting');
});

router.post('/webhook', async (req, res) => {
    // Validate verification token
    const data = JSON.parse(req.body?.data || '{}');
    const CORRECT_TOKEN = env.KOFI_VERIFICATION_TOKEN;
    const token = data.verification_token;
    if (CORRECT_TOKEN && token) {
        if (CORRECT_TOKEN !== token) {
            utils.log(`Request to kofi webhook rejected due to invalid token`);
            return res.end(`Invalid verification token.`);
        }
    }

    // Respond quickly
    res.status(200).send(`Received!`);

    // Collect and save donation data
    const transactionId = data.kofi_transaction_id;
    const amount = data.amount;
    const currency = data.currency;
    const email = data.email;
    db.prepare(
        `INSERT INTO donations (time_received, transaction_id, email, amount, currency) VALUES (?, ?, ?, ?, ?)`
    ).run(Date.now(), transactionId, email, amount, currency);
    utils.log(`Received ${amount} ${currency} Ko-fi donation from ${email}`);
});

module.exports = router;
