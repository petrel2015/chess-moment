# FAQ

## Is Chess Moment free?

Yes. Free to use, no sign-up, no ads. The footer has an optional donation entry if you want to support the maintainer.

## What skill level is it for?

Beginners who know how the pieces move, and casual players. Every lesson explains the rules and notation it uses (chess notation has hover glosses).

## Is there a new lesson every day?

The design goal is one lesson per day (morning/evening editions), but lessons are currently published manually at an irregular pace — the archive shows everything published so far (six lessons). Automated production is on the [roadmap](https://github.com/petrel2015/chess-moment/blob/main/doc/ROADMAP.md).

## Is the odds bar computed by an engine?

No. The win-probability numbers are teaching estimates written by the lesson author to convey "who is better after this move". They are not engine evaluations, and the page labels them as such.

## Why won't the AI coach just tell me the answer?

By design. The coach's system prompt forbids stating the solution moves — it explains ideas, rules and notation instead. Figuring it out yourself is the point. Try "Hint" first, then ask the coach a specific question.

## Do I need an API key for the AI coach?

No. The site embeds a default key for free models and works out of the box. Adding your own key gives you your own quota (see [Configuration](./configuration.md)).

## Does it work on mobile?

Yes — mobile is the primary target. Tap or drag to move, layouts are tuned for phone widths, and it can be added to an iPhone home screen.

## Is my progress saved?

Not yet — reloading resets the challenge to the start. Progress, streaks and mistake redo are planned for roadmap milestone M3.

## How does the WeChat article relate to the site?

Two renderings of the same data: the article is text plus static board images (suited to reading inside WeChat), and its "Read original" link opens the same lesson's interactive page.

## I found a mistake / want to contribute

Use the in-page "Report" button (it attaches position info) or [open an issue](https://github.com/petrel2015/chess-moment/issues). To author lessons yourself, the [Development Guide](./development.md#adding-a-new-lesson) has the full workflow and field reference.

## Is this open source?

The code is public on GitHub, but no license has been chosen yet (all rights reserved by default). Issues are welcome.
