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

Note that not all of these filters can be used multiple times. Internally, they're all combined together using AND, meaning, for example, searching `year=2019 year>2023` yields no results, because it's asking "give me maps that were ranked during 2019 and after 2023," which makes no sense. This may be adjusted in the future to use OR in certain circumstances.

To recap, consider the search query `stars>5.5 stars<7 freedom dive`. Referencing the above, this query finds maps whose titles or artists are similar to "freedom dive" and whose difficulties are between 5.5 and 7 stars.