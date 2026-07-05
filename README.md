# Relationship Memory Tracker for SillyTavern

A small SillyTavern extension that tracks relationship stats from `<relationship>` blocks, stores them persistently, and injects saved relationship memory back into the prompt.

## Features

- Parses `<relationship>` / rendered relationship blocks from model replies
- Tracks five independent axes:
  - Trust/Friendship
  - Love/Affection (emotional attachment)
  - Desire/Attraction (physical pull)
  - Hostility/Conflict
  - Jealousy/Possessiveness
- Keeps offscreen characters saved instead of deleting them
- Injects saved relationship memory into the prompt; the injection instructs the model to keep absent characters out of visible info blocks (no `*offscreen*` placeholders)
- Memory is stored per chat (keyed by chat id)
- Automatic migration from the old single Romance/Attraction axis: saved Romance values become Love/Affection, Desire starts as "Not yet assessed" until the character next appears
- Backward compatible parser: old-format `Romance/Attraction` lines are still read (as Love/Affection)
- An axis missing from a reply keeps its previously saved value instead of resetting to 0%
- Handles special spacing character `ㅤ`
- Includes a small draggable UI panel with Parse Last, Clear, and Copy buttons, plus per-character delete buttons
- Mobile UI is not supported yet. The extension can still run in the background, but the visual panel is intended for desktop use.

## Installation

1. Open SillyTavern.
2. Go to Extensions → Install Extension.
3. Paste this repository URL.
4. Click Install.
5. Restart or reload SillyTavern if needed.

## Usage

Open the Relationships button in the bottom-right corner.

Buttons:
- Parse Last: manually parses the latest assistant message
- Clear: clears saved relationship memory for the current chat
- Copy: copies current relationship memory
- ×: on each character card deletes that character's memory

The extension automatically updates saved memory from new model replies and injects saved relationship data before generation.

## Expected relationship format

```text
<relationship>
Relationship with {{user}} = Character Name:
Trust/Friendship: [50%] - [Internal Feeling sentence]
Love/Affection: [10%] - [Internal Feeling sentence]
Desire/Attraction: [5%] - [Internal Feeling sentence]
Hostility/Conflict: [0%] - [Internal Feeling sentence]
Jealousy/Possessiveness: [0%] - [Internal Feeling sentence]
Current Dynamic: One sentence about the overall emotional tension and direction.
; Second Character:
Trust/Friendship: [80%] - [Internal Feeling sentence]
...
</relationship>
```

Notes on the format:
- Trust/Friendship is the required axis — a character without it is skipped
- Each axis must stay on a single line
- The text after the dash can be a short status, a full sentence, or `Status (comment)` — all three parse
- Old-format `Romance/Attraction` lines are accepted and stored as Love/Affection
