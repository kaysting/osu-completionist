# Project to-do list

- [ ] Fully functional API
    - [ ] Custom element for showing endpoint details clearly and responsively
- [ ] Discord bot mirroring all website functionality to some degree
- [ ] osu IRC bot for checking stats and getting recommended maps using in-game chat
- [ ] Migrate static UI text to language file and make translations
- [ ] Partial reload between pages, effectively making the client a SPA
- [ ] Leaderboard meta render
- [ ] Allow filtering leaderboard by year using yearly stats or by country/team using users table
- [ ] Add "completion by star rating" to profiles in the same format as yearly
- [ ] Turn search into a popup that has buttons to go to dedicated map/user search pages
- [ ] Back up database remotely with SFTP
- [ ] Day/date search filter (support ranked= for dates to parity osu)
- [ ] Add map filters for `passedby` and `unpassedby` for filtering only passed/unpassed maps for a specific user
- [ ] Move logout and other user settings to a dedicated settings popup
- [ ] Add leaderboard rank change indicator for past few days
- [ ] Add beatmap card preview audio volume control
- [ ] Create a unified beatmap search page and use it for play next
- [ ] Allow switching monthly graph to cxp

**Completed**

- [x] Add client local time timestamps to pass feed
- [x] Add ability to specify ms timestamps and format as data attributes and have the client parse them and add titles
- [x] Embeddable renders suitable for osu bios
- [x] Web redesign with sidebar nav
- [x] Make monthly passes graph update in real time
- [x] Make each year in yearly stats clickable and open a pop-up with a big progress bar and more stats info
- [x] Continue to build osu score cache. Constantly fetch new scores from global recents and expose a websocket that broadcasts new scores so other apps can just listen
- [x] When saving recent scores, only fetch maps that we don't have/aren't ranked or loved
- [x] Switch to icon based category selection
- [x] Animate popups
- [x] Automatically determine and save the best category for each user when updating stats
- [x] Fix meta description wrapping
