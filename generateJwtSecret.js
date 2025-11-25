const crypto = require('crypto');

const secret = crypto.randomBytes(32).toString('hex');

console.log(`Paste this cryptographically secure random value into config.json as "jwt_secret":\n${secret}`);