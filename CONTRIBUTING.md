# Contributing to osu!complete

Hi! I'm so so happy to hear that you're thinking about contributing to the project.

Note that **all communication happens on [the Discord server](https://discord.gg/fNSnMG7S3C)**, including issue reports, feature suggestions, and development conversation. If you'd like to report an issue or develop for the project, please join there and chat with us!

To respect your time and mitigate wasted effort, please keep in mind the following:

### Discuss before you write

Before writing any code, please [join the Discord server](https://discord.gg/fNSnMG7S3C) and talk to Kayla so everyone's on the same page. We're open to considering new feature implementations, existing feature updates, and fixes for ongoing issues.

### About refactors and rewrites

I'm currently **not accepting** large-scale refactors, rewrites, or architectural changes. This includes switching to a framework, moving to TypeScript, or reorganizing the project's folder structure.

This project will continue to use Node.js, Express, EJS, vanilla JS, and vanilla CSS for the foreseeable future.

**Pull requests that attempt to rewrite, refactor, or restructure the project without significant prior communication will be closed.**

### Format your code

Use your IDE (likely VSCode) to your advantage! Install the Prettier extension and enable **format on save** in your VSC settings to ensure all code in your PR is nicely formatted and readable.

This project comes with a `.prettierrc` file that should tell your IDE exactly how to format source code automatically.

Also leave comments wherever needed so the rest of us (and future you) know what you your code does/should be doing. Basic etiquette.

### Test your code

Please test your code before you submit a PR to ensure your changes are functional.

You can find development environment setup instructions on the project readme. Use these instructions to get a local server and/or updater running so you can test your code live.
