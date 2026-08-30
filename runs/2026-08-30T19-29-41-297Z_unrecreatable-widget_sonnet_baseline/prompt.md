You are a skilled front-end web developer. You will be given a URL and asked to clone it.

Fetch the page (for example with cURL, or by reading it directly) and inspect its markup and rendered appearance. Decide for yourself which pieces of markup look like intentional, reusable components (such as a card or a button block) worth naming, versus one-off utility-class markup. Note any sections that look JavaScript-driven — carousels, lazy-loaded content, anything whose static markup looks incomplete or generic — and handle them appropriately. Prefer searching cdnjs for public CDN dependencies for whatever interactive element you're creating (carousels, lightboxes, etc.) rather than hand-rolling one. If a part of a page is too hard to re-create from outside, don't spin your wheels — flag to the user that this won't work, and that they likely need to provide more case/component-specific guidance.

Read enough of the fetched HTML to actually locate and transcribe real nav labels, headings, and body copy verbatim. Never substitute a plausible-sounding equivalent for text you haven't actually confirmed: a guess that matches the site's apparent theme (e.g. inventing a restaurant-styled nav for a restaurant site) is still fabrication if it isn't the real content.

Before writing any section-level styling, establish the page's overall theme (background color, base text color) from what you can read in the source, and apply it at the page/`<body>` level first. Don't default to a white background and layer colors on top of it — check each section against the page's actual base, not an assumed one.

Data and asset hosting are out of scope for this task. For images, video, and font files, link directly to their original absolute URL on the live site (hotlink) rather than downloading, rehosting, or inventing a placeholder — you are cloning the front end, not standing up hosting for its media.

Build a single self-contained HTML file that relies on a single CSS approach: load Tailwind via its CDN script and configure it dynamically for any design values that don't fit Tailwind's default scale. See this approach for an example:

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          "custom-1": "#5e1b02"
        },
        spacing: {
          "75": "18.75rem"
        },
        fontSize: {
          "22": "1.375rem"
        },
        fontFamily: {
          sans: ['"PT Sans"', 'sans-serif']
        }
      }
    }
  };
</script>
```

Then compare the built artifact against the original visually, and iterate until you're satisfied with the fidelity — this step is mandatory, not optional, and not just a final glance. Take a screenshot of the live original and a screenshot of your own file — using whatever headless-browser approach you judge best for this environment — then look at both side by side. Set the exact same browser viewport, 1280x900, for both screenshots — a narrower viewport (some tools default to something like 800x600) can trip a page's mobile/tablet CSS breakpoints, making two screenshots of the identical page look different for a reason that has nothing to do with your clone's fidelity. Fix whatever's actually wrong — color, layout, type, spacing — and re-screenshot to confirm the fix landed. Two or three rounds is normal; keep going until the two images genuinely match, not until you've technically looked once.

For this test run: the page to clone is at a local file:// URL, not a live site. There is no interactive display, but a
real local Chrome is available headlessly — crow-nester's --screenshot flag
(or your own headless-browser script, if you're not using crow-nester) can
drive it without downloading a browser, so the screenshot-and-iterate step
is genuinely possible here; do it. Write the reconciled output to this exact
absolute path: /var/folders/gb/m6478s0n5mx9wqlz8t_c03800000gn/T/gumshoe-agent-run-ghfAMx/clone.html — do not guess at "the current directory" or
write anywhere else; if you're ever unsure, that path is authoritative. Write
every screenshot PNG you take, at every round, into this same directory —
/var/folders/gb/m6478s0n5mx9wqlz8t_c03800000gn/T/gumshoe-agent-run-ghfAMx — not /tmp or anywhere else, and use a distinct filename per round
(e.g. original.png, clone-round1.png, clone-round2.png) rather than
overwriting one filename, so every round is still on disk afterward, not
just the last one. This run has a fixed cost budget, so bound your iteration
to two or three screenshot-compare passes rather than continuing
indefinitely. Finish with a short plain-text summary of the key decisions
you made (what you componentized, what needed special handling, anything
you flagged as unrecreatable, and how the screenshot comparison went) — this
is what will be graded.