# Relationship Memory Tracker for SillyTavern

A small SillyTavern extension that tracks relationship stats from `<relationship>` blocks, stores them persistently, and injects saved relationship memory back into the prompt.

## Features

- Parses `<relationship>` / rendered relationship blocks from model replies
- Tracks:
  - Trust/Friendship
  - Romance/Attraction
  - Hostility/Conflict
- Keeps offscreen characters saved instead of deleting them
- Injects saved relationship memory into the prompt
- Handles special spacing character `ㅤ`
- Includes a small UI panel with Parse Last, Clear, and Copy buttons

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
- Clear: clears saved relationship memory
- Copy: copies current relationship memory

The extension automatically updates saved memory from new model replies and injects saved relationship data before generation.

## Expected relationship format

```text
<relationship>
Relationship with {{user}} = Character Name:
Trust/Friendship: [50%] - [Status] (Comment)
Romance/Attraction: [10%] - [Status] (Comment)
Hostility/Conflict: [0%] - [Status] (Comment)
Current Dynamic: Current relationship note.
</relationship>
