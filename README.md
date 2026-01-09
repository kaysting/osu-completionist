# [osu!complete](https://osucomplete.org)
A modern, feature-rich osu! completionist tracker and leaderboard.

Currently available at https://osucomplete.org

![Promo](/public/assets/images/promo.png)

## Features
- **Easy import process:** Just sign in with your osu account and get added to the import queue. Soon enough, your stats will be visible.
- **Real-time updates:** New passes and all user stats are updated as soon as they're available (checked every minute).
- **Full support:** osu!complete completely supports all game modes, ranked, loved, and even convert maps.
- **"Play next" section:** Unsure what to play next? Use the "what to play next" card on your profile to find maps similar to your recent passes that you haven't played yet.
- **Modern, osu!-like design:** Built from the ground up with osu! players in mind, the website is designed to be easy on the eyes.
- **Responsive layout:** The webapp is fully responsive, making for an excellent experience on both desktop and mobile devices.

## Running the project yourself
Note that the intent of these instructions is NOT to teach you how to run your own public instance of osu!complete. They are intended to help you set up a functional development environment and make contribution easier.

**Required steps:**
1. Install [Node.js](https://nodejs.org/en/download) and [SQLite](https://sqlite.org/download.html)
2. Clone the repo and open it in your terminal
3. Run `npm install`
4. Copy `.env.example` to `.env` and open it in a text editor
5. Create an osu! application in [your account settings](https://osu.ppy.sh/home/account/edit#oauth)
6. Set the `OSU_CLIENT_ID` and `OSU_CLIENT_SECRET` env variables to the values provided by osu!
7. Set env `WEBSERVER_PORT` to your desired port or leave it blank to use `8080`
8. Run `npm run maintain -- makedb` to create the database
9. Populate the database with beatmap data
   1. Run `npm run maintain -- dldump` to download the latest osu! data dump
   2. Run `npm run maintain -- importmaps` to read the dump and fetch map data from the osu! API (this will take a few hours)
10. Run the webserver process with `npm run webserver`
11. Run the updater process with `npm run updater`

Consider using a process manager like [PM2](https://pm2.io/) if you need to keep the server and updater running in the background.

**If you need user authentication working:**
2. Add `http://localhost:8080` (or your webserver address) as a redirect URI in your osu! application's settings
3. Set env `JWT_SECRET` to a secure, random value
    * Run `npm run maintain -- getsecret` to generate a suitable value

These instructions aren't fully tested so please [join the Discord server](https://discord.gg/fNSnMG7S3C) if you need any help.