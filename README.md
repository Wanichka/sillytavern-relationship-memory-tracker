# Relationship Memory Tracker for SillyTavern

A small SillyTavern extension that tracks relationship stats from `<relationship>` blocks, stores them persistently, and injects saved relationship memory back into the prompt.

## Features

- Use **✎** next to a character's **Names** button in settings to set a display name for this chat. Leave it empty to restore the original name. Matching, saved relationship values, and names in the injected memory remain unchanged.

- Parses `<relationship>` / rendered relationship blocks from model replies
- Tracks five independent axes:
  - Trust/Friendship
  - Love/Affection (emotional attachment)
  - Desire/Attraction (lasting attraction, separate from current arousal)
  - Hostility/Conflict
  - Jealousy
- Keeps offscreen characters saved instead of deleting them
- Injects only character names and measured relationship percentages into the memory prompt, with general interpretation instructions. Axis statuses, comments, scene dynamics and presence flags remain available in the panel but are never injected. Existing saved memory is filtered automatically; no clearing or re-parsing is needed.
- Missing/unmeasured axes are omitted from the prompt instead of becoming confirmed zeroes. Old chat messages are not modified or filtered.
- Memory is stored per chat (keyed by chat id)
- Automatic migration from the old single Romance/Attraction axis: saved Romance values become Love/Affection, Desire starts as "Not yet assessed" until the character next appears
- Backward compatible parser: old-format `Romance/Attraction` lines are still read (as Love/Affection)
- An axis missing from a reply keeps its previously saved value instead of resetting to 0%
- Handles special spacing character `ㅤ`
- Includes a small draggable UI panel with Parse Last, Clear, and Copy buttons, plus per-character delete buttons
- The settings gear shows draggable name tiles. Drag a tile to any position, including from the bottom of a long list to the top; the settings list scrolls automatically near its edges. The order is saved with the current chat and used in the relationship panel. Focus a tile handle and press Up/Down for keyboard movement.
- Each tile has a **Names** button for alternate names of the same character. For example, add `Ло, Trafalgar Law` to `Трафальгар Ло`. New `<relationship>` entries using either name update the main card. Existing duplicate cards are kept until you choose to delete them yourself.
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
- Copy: copies the same percentages-only memory text used for prompt injection
- ×: on each character card deletes that character's memory
- ⚙: open settings to order cards and edit alternate names

The extension automatically updates saved memory from new model replies and injects saved relationship data before generation.

## Relationship progression and attraction (v2.6.0)

Desire/Attraction now means **relatively stable attraction to a specific person**, not current arousal or an urgent need for sex. A character can have 94% Desire, zero current arousal, and spend a scene focused on work or rest. High attraction may stay in the background. Independent flirting and initiative remain possible when they fit the character and situation; repeated advances, sexual thoughts, touch, or a minimum arousal level are not required. Sexual satisfaction and declining arousal do not by themselves lower lasting attraction.

The matching progression module provides these rules:

- Each measured axis grows by **+1 percentage point per reply only when newly earned**; otherwise it stays unchanged unless a decrease is justified. Multiple qualifying moments do not stack increases on one axis in one reply.
- **Decreases have no -1 cap.** Their magnitude follows the event's actual effect on that particular relationship axis. Ordinary friction and passing moods do not justify large drops. A serious rupture may justify a substantial loss; rebuilding still follows the +1 rule.
- Hostility and Jealousy may decrease substantially when their real causes weaken or resolve, but a pleasant moment does not erase an unresolved cause.
- Repeated expressions of existing attraction do not automatically increase Desire. Routine care does not automatically increase Love, but an ordinary act can qualify if new significance genuinely deepens attachment.
- Trust does not require exclusive vulnerability or blind agreement. Love may be romantic, familial, platonic, comradely, or uncertain; high attachment does not require dependence, fear of loss, or organizing one's entire life around the user.
- Fear, disagreement, irritation, or being overruled increases Hostility only when it actually strengthens directed conflict. Zero Hostility or Jealousy may mean no such feeling; high values do not prescribe obsession, control, or aggression.
- Stages and custom statuses describe each axis's state and strength, not promised actions, access, consent, or temperament. Confession is available at 70%+ romantic Love, but no number or elapsed-scene timer makes it mandatory. Characters may create a fitting opportunity themselves. Existing proposal and player-choice boundaries remain.
- Unmeasured axes are initially assessed from established lore and relationship history, not from an automatic zero or +1. Corrections to measured values require established evidence: upward at most +1 per relevant reply, downward by a justified amount. Updated wording alone never recalculates memory.

### Install the matching prompts

1. Update the extension in SillyTavern and reload the page.
2. Replace your old `<relationship_progression>...</relationship_progression>` module with [Relationship progression](prompts/relationship_progression.txt). Remove the old copy so conflicting rules are not left active.
3. Replace only the `<relationship>...</relationship>` field inside your multi-character stats template with [Relationship template](prompts/relationship_template.txt). Keep the other stats fields, including `<char_arousal>`, as they are.
4. If your preset has a relationship checklist item, make it refer to the new module: evaluate axes independently, allow +1 earned growth or proportionate decreases, distinguish lasting attraction from current arousal, and do not schedule character actions from percentages.

These prompt files are **reference templates; the extension does not load them automatically**. The extension injects short interpretation reminders, while the full module supplies the detailed rules. Current arousal continues under the preset's existing rules and is not added to persistent relationship memory.

### Compatibility and verification

Saved percentages, including existing high Desire values, are preserved. No clearing, numeric migration, or re-parsing is required. Legacy axis names, alternate character names, card ordering, chat metadata/localStorage storage, and participation across parallel scenes are unchanged. Only names and measured percentages enter the memory prompt; statuses, comments, scene dynamics, and presence flags stay out of it.

Progression is **model guidance, not a numeric clamp in the parser**: the extension continues to save measured values from replies. The updated module and reminders do not programmatically evaluate narrative events, consent, or arousal.

Run the regression checks with `node --test tests/memory-controls.test.cjs`. They cover storage and aliases, preserved high attraction, percentage-only injection, unmeasured axes, substantial losses with omitted axes retained, and legacy labels. Try the prompts with your model in ordinary high-attraction scenes, fitting independent flirtation, post-intimacy recovery, serious loss of trust, and resolution of jealousy. Code checks cannot establish how a particular model will roleplay those scenes.

## Visible characters in info blocks (v2.5.1)

The injected instructions determine participation from **all ongoing scenes shown in the current reply**, including parallel scenes away from `{{user}}`. A character directly shown acting, speaking, or thinking counts even if they leave before the reply ends. A name mentioned only in dialogue, recollection, plans, speculation, or saved memory does not count by itself.

Use the same cast across the applicable character fields. The no-characters fallback applies only when no non-user character directly participates anywhere in the reply. Saved memory is not a cast list; participation, absence, and return do not reset relationship percentages. Each relationship entry still describes the character's relationship with `{{user}}`, even when `{{user}}` is elsewhere.

For a custom infoblock prompt, optional matching replacements are provided:
- [Infoblock rules](prompts/infoblock_rules.txt)
- [Relationship template](prompts/relationship_template.txt)

Replace the corresponding fragments in your own prompt if they still use the old presence rule. These files are reference templates and are not loaded automatically by the extension.

For example, when Law and Rosinante act and speak in a parallel scene away from Alice, both belong in that reply's character info blocks. Alice's name being mentioned does not alone make her a participant.

Update the extension in SillyTavern, reload the page, and regenerate the affected reply. Existing saved relationship memory does not need to be cleared. This changes model instructions; it does not programmatically detect narrative participants.

## Expected relationship format

```text
<relationship>
Relationship with {{user}} = Character Name:
Trust/Friendship: [50%] - [Internal Feeling sentence]
Love/Affection: [10%] - [Internal Feeling sentence]
Desire/Attraction: [5%] - [Internal Feeling sentence]
Hostility/Conflict: [0%] - [Internal Feeling sentence]
Jealousy: [0%] - [Internal Feeling sentence]
Current Dynamic: One sentence about the current relationship and its unresolved issues, not its future direction.
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

