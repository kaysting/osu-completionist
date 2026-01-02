const express = require('express');

const router = express.Router();

router.use((req, res, next) => {
    res.sendOk = data => {
        res.status(200).json({
            success: true,
            ...data
        });
    };
    res.sendError = (status, code, message) => {
        res.status(status).json({
            success: false,
            error: {
                code,
                message
            }
        });
    };
    next();
});

router.get('/', (req, res) => {
    res.sendOk({});
});

router.use((req, res) => {
    res.sendError(404, 'not_found', `The requested endpoint doesn't exist.`);
});

module.exports = router;