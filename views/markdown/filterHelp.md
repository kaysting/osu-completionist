In the search bar, you can enter key words to search within beatmap titles, artists, and difficulty names, but you can also use filters to easily get beatmaps fitting the criteria you specify. **Play next search only shows maps you haven't passed yet.**

Filters can be used in addition to text searches as long as you separate them with spaces.

A filter might look like `stars>5.5` or `year=2019`. They take the form of `key operator value`, where `key` is the metric you want to filter, `operator` is the comparison you want to make, and `value` is the value you want to filter the metric to. 

Valid filter keys include:
- `cs`: Circle size (or key count in mania)
- `ar`: Approach rate
- `od`: Overall difficulty (aka accuracy)
- `hp`: HP drain
- `keys`: Alias of `cs` meant to be used with mania
- `stars` or `sr`: Star rating/difficulty
- `bpm`: Map BPM
- `length`: Map duration
- `year`: Map ranked year
- `month`: Map ranked month (in `yyyy-mm` format), for example, "2019-05" shows maps ranked during May of 2019
- `mode`: Map mode (`osu`, `taiko`, `catch`, or `mania`) (**This won't work in play next, only global search!**)

Valid operators include:
- `=`: Equal to
- `<`: Less than
- `>`: Greater than
- `<=`: Less than or equal to
- `>=`: Greater than or equal to

Additional notes:
- **Range filters:** You can use a hyphen to specify a range, like `length=90-180` (between 90 and 180 seconds). This works for all numeric filters.
- **List filters:** You can separate values with commas, like `year=2019,2021,2023`, to find maps matching ANY of those values.
- **Smart integer ranges:** Providing a whole number like `stars=5` will automatically search the full range (e.g. from 5.00 up to 6.00).
- **Exclusive Constraints:** Filters are additive (`AND` logic). Using `stars=5` and `stars=6` together will yield zero results because a map cannot be both 5 stars AND 6 stars at the same time.

To recap, consider the search query `stars = 5.5-7 ar>9 freedom dive`. Using the above, we can deduce that this query finds maps whose titles or artists are similar to "freedom dive", between 5.5 and 7 stars, with an AR greater than 9.