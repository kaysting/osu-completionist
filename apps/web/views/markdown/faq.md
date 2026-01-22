# osu!complete FAQ
Welcome to osu!complete! Below are some common questions we get along with their answers to help you better understand how things work around here. Keep an eye on this page for new answers every so often!

## How can I view my stats here?
Simply [log in with your osu! account](/auth/login) and you'll be immediately sent to your profile.

We'll perform an initial import on your account where we use the "most played" section on your osu! profile to determine what maps we need to check, then check those maps to collect a list of the ones you've passed.

Once this process is complete, your osu!complete profile should be an accurate reflection of your osu! completion.

## What is completion xp (cxp)?
Completion XP (or cxp, stylistically lowercase), is osu!complete's version of a "score". cxp (or its derivation) is used in most major calculations for rank and percentage.

cxp is calculated as the nomod length of all maps you've passed in seconds divided by 10.

This metric aims to give more weight to longer maps, as they account for more of osu!.

## How is completion percentage calculated?
Completion percentage (as seen at the top of your profile and on leaderboards) is calculated by dividing the length of all maps in a category by the length of the maps you've completed, irrespective of the mods you used to pass them. This can also be seen as dividing your cxp by the total available cxp in a category.

## What is rank based on?
Rank is based on cxp (though internally just the length of the maps you've passed).

## Do unavailable maps (due to DMCA, etc.) count?
Yes. All maps with a permanent leaderboard (ranked, approved, loved) count for completion.

Whether or not loved maps and maps converted from osu! standard to other modes are included depends on your category selection, available at the top of leaderboard, profile, and play next pages.

## Why am I missing some of my passes?
While initial import using your most played section is usually accurate, there are some cases where you might be missing passes. Find and click the link on your profile page labeled "help, my stats aren't accurate", read the detailed explanation, and follow the prompt to start a full import.

## How often are my stats updated?
We check for new passes from all tracked users roughly once a minute, and we update the stats for all users who got new passes. This means that passing a new map will result in your stats being updated almost immediately.

## How is osu!complete able to check everyone's recent scores so frequently?
The osu! API exposes an endpoint that allows us to request a list of all passing scores submitted to the osu! servers, either after a specific point, or the most recent 1000. This is the secret sauce for getting passes for upwards of a thousand users almost instantly.