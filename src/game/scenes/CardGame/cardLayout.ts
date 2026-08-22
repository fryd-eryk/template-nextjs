import type { AetherCategory, CardInstance, CardType } from '../../types/Card';
import type { PlayerState } from '../../types/GameState';

// Where a card's art jpg lives under public/assets, keyed by CardType — each type has its
// own type-named subfolder (see Preloader.ts / CardCreatorPreview.ts, the two loaders).
export const ART_FOLDER_BY_TYPE: Record<CardType, string> = {
    minion: 'minions',
    spell: 'spells',
    token: 'tokens',
    aether: 'aethers',
};

// Base game resolution — must match the `width`/`height` in game/main.ts's Scale config.
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;
export const CENTER_X = GAME_WIDTH / 2;
export const CENTER_Y = GAME_HEIGHT / 2;

// 2:3 ratio, matching the 832x1248 art assets exactly — so a full-bleed cover-fit (see
// coverFit) never needs to crop, the art's own aspect ratio already fills the card exactly.
export const CARD_W = 174;
export const CARD_H = 260;

// Shared face-down texture — key must match Preloader.ts's load.image call.
export const CARD_BACK_KEY = 'card-back';
// Distinct face-down texture for `type: 'aether'` cards — same load-key contract as CARD_BACK_KEY.
export const CARD_BACK_AETHER_KEY = 'card-back-aether';
export const HERO_RADIUS = 32;
export const HERO_SIZE = HERO_RADIUS * 2;
export const BOARD_ZONE_W = 1600;

// Row Y-positions are hand-tuned so hero/board rows and the hand states below clear each
// other with a small gap given CARD_H/HERO_RADIUS above — see the git history of this file if
// those change again.
//
// Hands don't occupy a permanent dedicated row. Each hand rests "poked" against its owner's
// screen edge — card center pinned exactly on the edge, so only the CARD_H/2 half that's on-screen
// is visible (Phaser/the canvas clips the rest for free, no mask needed) — and its owner's hero
// overlaps that poke, drawn on top via HERO_DEPTH, like the hero is standing in front of a mostly
// tucked-away fan of cards. The hero never moves off HERO_Y for either side — only individual
// hand cards animate (see HAND_ARC_* / PLAYER_HAND_PEEK_Y below).
//
// Idle hand cards fan out in a slight arc (see HAND_ARC_* and handCardSlot in index.ts) rather
// than sitting in a flat row — center card upright and least-hidden, cards further out rotate
// away from center and sit closer to the flush poke edge (more hidden), mimicking a fan pivoting
// from a point beyond the screen edge. The opponent's hand *only* ever exists in this idle arced
// state — it never peeks (a deliberate "nothing happens" twist, see renderHand in index.ts). The
// player's hand additionally supports peeking ONE card at a time on hover: that card alone
// straightens (rotation 0) and rises to PLAYER_HAND_PEEK_Y, fully clear of the screen's bottom
// edge; every other card stays in its idle arced slot. 
//
// Freeing the opponent's hand from its own row lets OPPONENT_BOARD_Y move up (it no longer needs
// to clear a full hand row below the opponent's hero), which in turn opens up a deliberately
// generous gap between the two boards — the freed space's biggest single beneficiary, giving the
// battlefield itself more visual weight instead of the two rows sitting seam-to-seam.
export const OPPONENT_HERO_Y = 37;
export const OPPONENT_HAND_Y = 50;
export const OPPONENT_BOARD_Y = 265;
export const PLAYER_BOARD_Y = 600;
export const PLAYER_HAND_POKE_Y = GAME_HEIGHT - CARD_H / 2; // poked flush against the bottom edge
export const PLAYER_HERO_Y = PLAYER_BOARD_Y + 180; // fixed — the hero never moves, see above

// How far a peeked card's own edge sits clear of the screen's bottom edge — tuned by eye, so it
// doesn't sit flush against it.
export const HAND_PEEK_EDGE_CLEARANCE = 10;
export const PLAYER_HAND_PEEK_Y = GAME_HEIGHT - CARD_H / 2 - HAND_PEEK_EDGE_CLEARANCE;

// Extra top/bottom margin (px) on the invisible peek-hover zone (renderHand, index.ts), beyond
// the card's idle-to-PLAYER_HAND_PEEK_Y travel span it already covers end to end — a little
// breathing room past both endpoints so the mouse resting right at either extreme still reads as
// clearly "inside," rather than sitting exactly on the boundary.
export const HAND_PEEK_HOVER_MARGIN = 20;

// Hero containers is never out ranking a card
export const HERO_DEPTH = 10;

// Depth for whichever single hand card is currently peeked (hover) — must out-rank every hand
// card's own fan depth AND HERO_DEPTH (a centered peek must never be partially hidden behind the
// hero), while staying well clear of drag's depth (1000) above.
export const HAND_PEEK_DEPTH = 400;

// Hand fan/arc (handCardSlot in index.ts, used for both hands' idle layout) — a "hinge chain"
// model: adjacent cards' visible edges (top edge for the player, bottom edge for the opponent —
// whichever one is actually poking into view) are joined end to end, exactly like a fanned hand of
// real cards, so there's never a visible seam between neighbors regardless of hand size or how
// much the outer cards have rotated. Two independently tunable knobs:
//
// - HAND_ARC_ANGLE_STEP_DEG / HAND_ARC_MAX_ANGLE_DEG: a card `n` slots from the hand's center
//   rotates by `n * HAND_ARC_ANGLE_STEP_DEG`, clamped at HAND_ARC_MAX_ANGLE_DEG so a very large
//   hand's outermost cards don't over-rotate. This is the *only* input to the fan's shape —
//   handCardSlot derives each card's position by chaining visible-edge segments (length CARD_W,
//   direction given by each card's own rotation) end to end, so there is no separate "lift curve":
//   once rotation is fixed, each card's height relative to its neighbors follows automatically
//   (an earlier version of this code drove height off a second, independent step+max-angle pair —
//   that let a card's own rotation swing its *corners* away from its neighbor's, which is exactly
//   what produced a visible seam between cards; see git history).
// - HAND_ARC_LIFT: the whole chain's peak amplitude (px) — how far the fan's highest point (the
//   hinge between the two center cards for an even-sized hand, or the exact center card's own
//   upright edge for an odd-sized hand) rises above the flush poke edge. Purely an anchor/offset
//   for the chain as a whole; it does not affect the chain's shape (that's rotation's job alone).
export const HAND_ARC_ANGLE_STEP_DEG = 4;
export const HAND_ARC_MAX_ANGLE_DEG = 18;
export const HAND_ARC_LIFT = 26;

// The hand row's spacing, always — not just a fallback floor for large hands (handRowLayout in
// index.ts scales the whole row down once even this can't fit within BOARD_ZONE_W, rather than
// shrinking spacing further). Deliberately tighter than CARD_W so idle cards read as a natural
// overlapping fan rather than a flat row with gaps between them, while staying the *widest*
// spacing that still overlaps zero pixels of a neighbor's cost badge — kept separate from the
// plain rowLayout board/hand share, since this is a 'full'-mode cost-badge concern that doesn't
// apply to renderBoard's cost-badge-less 'simplified' cards. 'full' mode's cost number sits
// right-anchored 3px from the card's right edge (COST_TEXT_STYLE at CARD_W/2-3) and is a single
// digit (~11px wide at that font — every card cost in cards.ts is single-digit), so its own left
// edge sits CARD_W - 3 - 11 in from the card's right edge. Per-card depth is ascending
// left-to-right, so a rightward neighbor always paints over the card to its left — z-order alone
// can't avoid that (see handRowLayout's doc comment) — so CARD_W - 3 is the tightest spacing at
// which the neighbor's own left edge lands exactly on the digit's right edge without crossing
// into it, i.e. the badge stays fully visible right up to the edge of safe.
export const HAND_MIN_SPACING = CARD_W + 3;

// Deck/graveyard piles share the end-turn/cancel buttons' column, offset further right so hand
// cards (which can extend close to x=1760 at max hand size) never overlap them.
export const PILE_X = 1860;
export const OPPONENT_DECK_Y = 240;
export const PLAYER_DECK_Y = GAME_HEIGHT - 240;

export const DECK_PILE_W = 80;

// The Aether Deck pile mirrors the Main Deck/Graveyard column onto the opposite (left) screen
// edge, at the same offset from that edge and the same heights — opponent's near the top,
// player's near the bottom ("bottom-left of the board").
export const AETHER_PILE_X = PILE_X - DECK_PILE_W * 1.5;
export const OPPONENT_AETHER_DECK_Y = OPPONENT_DECK_Y;
export const PLAYER_AETHER_DECK_Y = PLAYER_DECK_Y;

// Matches CARD_W:CARD_H's 2:3 ratio exactly (see that constant's comment) so coverFit's cover-fit
// of the deck pile's card-back image never needs to crop — an earlier 80x100 (4:5) box cropped the
// top/bottom off the card-back art since its real aspect ratio didn't match the box it was fit into.
export const DECK_PILE_H = DECK_PILE_W * (CARD_H / CARD_W);

// Each player's graveyard sits one row from its own deck, on that player's side of the column:
// the player's below its deck, the opponent's above its deck. PILE_ROW_GAP has to clear a pile's
// *full* drawn extent — the stack offset and zone label above it, the count label below it
// (~152px in total) — not merely DECK_PILE_H, or the two piles' labels overlap.
export const PILE_ROW_GAP = 165;
export const OPPONENT_GRAVEYARD_Y = OPPONENT_DECK_Y - PILE_ROW_GAP;
export const PLAYER_GRAVEYARD_Y = PLAYER_DECK_Y + PILE_ROW_GAP;

// Aether-in-play — each side's own resource base. Generic Aether gets its own round pool marker
// (renderAetherMarker) rather than a pile; the 4 elemental categories each get one small pile
// (renderAetherInPlay), reusing the Deck/Graveyard/Aether Deck piles' own DECK_PILE_W/H footprint
// instead of a card row — a resource base reads at a glance, it doesn't need to look like a
// battlefield object. Fixed at AETHER_ROW_X_START (near the board's left edge, clear of hand cards
// at any real hand size — see HAND_MIN_SPACING). Row 0 (the first elemental pile in play order —
// fire, water, earth, air) is anchored flush against that side's own screen edge — the player's at
// the bottom, the opponent's at the top, AETHER_ROW_EDGE_CLEARANCE short of the true edge, same
// idiom as PLAYER_HAND_PEEK_Y's own edge clearance — and each subsequent row grows AETHER_ROW_
// SPACING further toward screen center. A category with zero cards in play is skipped rather than
// drawn empty, so the column never shows a gap for a category this player hasn't drawn into yet.
// The generic marker isn't part of this column at all — see AETHER_MARKER_OFFSET_X below — so it
// doesn't shift the elemental rows. Both spacing values are eye-tuned and confirmed in the browser,
// including a side with several elemental categories in play simultaneously.
export const AETHER_ROW_X_START = 50;
export const AETHER_ROW_EDGE_CLEARANCE = 10;
export const OPPONENT_AETHER_ROW_START_Y = DECK_PILE_H / 2 + AETHER_ROW_EDGE_CLEARANCE;
export const PLAYER_AETHER_ROW_START_Y = GAME_HEIGHT - DECK_PILE_H / 2 - AETHER_ROW_EDGE_CLEARANCE;
export const AETHER_ROW_SPACING = 130;

// The generic-Aether round marker (renderAetherMarker) sits beside the elemental column's row 0 —
// same side-edge-aligned Y, offset this far to the right — rather than inside the column itself,
// since it's a different shape (a small circle vs a DECK_PILE_W/H tile) and always present
// (unlike an elemental pile, it's never skipped at 0 cards). One tile-width past
// AETHER_ROW_X_START reads as "right next to" the column without overlapping it.
export const AETHER_MARKER_OFFSET_X = DECK_PILE_W;

// Click-a-pile-to-inspect overlay. Depth sits above every in-game depth — including the 3000 an
// in-flight draw animation uses — so the overlay stays readable if a pile is opened mid-animation.
export const PILE_VIEW_DEPTH = 5000;
export const PILE_VIEW_MAX_COLUMNS = 8;
export const PILE_VIEW_GAP = 28;
export const PILE_VIEW_TOP = 150;
export const PILE_VIEW_BOTTOM = 1020;

// Where a played card is held for a beat before flying to its resting place, and where a card
// needing a target is held while the player picks one (see renderHand's held-card branch).
export const SPOTLIGHT_X = 260;

// The "drop here to cancel" region for a dragged hand card (see wireDragEvents in index.ts) — an
// invisible drop zone covering the idle hand's visual footprint, generously margined so a fast
// drag release near the hand still reads as a cancel rather than an accidental cast. Centered on
// the bottom screen edge; height extends both above and below it (the lower half sits off-screen,
// harmless) so the zone's true top edge is HAND_DROP_ZONE_H above GAME_HEIGHT.
export const HAND_DROP_ZONE_W = BOARD_ZONE_W + 320;
export const HAND_DROP_ZONE_H = CARD_H + HAND_ARC_LIFT + 80;

// Phaser Text objects rasterize to their own internal canvas at this multiple of their
// font size, independent of any later container/camera scale (confirmed against
// node_modules/phaser/src/gameobjects/text/Text.js — resolution defaults to 1 and is
// NOT derived from any Game Config setting in this Phaser version, despite what the
// hosted API docs imply). At `resolution: 1`, a 10-19px on-card font is a genuinely
// tiny source bitmap, so any card rendered bigger than its native CARD_W/CARD_H — a
// board/hand card on a browser window wider than the game's 1920x1080 base resolution
// (Scale.FIT stretches the canvas via CSS in that case), or the Card Creator's
// preview, which deliberately renders bigger — blurs exactly like an upscaled raster
// image. Every on-card Text uses this; off-card UI chrome (health/mana readouts, pile
// labels, tooltip body text — SMALL_STYLE/PILE_LABEL_STYLE/statStyle) doesn't need it,
// since none of those get scaled up beyond the game's own base resolution.
const CARD_TEXT_RESOLUTION = 3;

/** Adds a black outline to a text style, for legibility over full-bleed art — every on-card text element uses this; off-card UI chrome (health/mana readouts, pile labels, tooltip body text) does not. */
export function withStroke(style: Phaser.Types.GameObjects.Text.TextStyle, thickness = 3): Phaser.Types.GameObjects.Text.TextStyle
{
    return { ...style, stroke: '#000000', strokeThickness: thickness, resolution: CARD_TEXT_RESOLUTION };
}

// Cinzel Bold — self-hosted (public/assets/fonts/cinzel/), loaded via fonts.ts's
// ensureCardFontsLoaded before any card Text is created. 'Arial' fallback covers the case
// where that load ever fails (e.g. request blocked) rather than rendering blank glyphs.
export const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: '"Cinzel", Arial, sans-serif', fontSize: '12px', color: '#ffffff', align: 'left' });
// Extra pixels Phaser adds between wrapped lines of the 'full' mode description box's rule text
// (definition.text) — edit this to tighten/loosen its line-height. Independent of DESC_BOX_LINE_GAP
// (the gap between the keyword line and the start of the rule text, a different measurement).
export const RULE_TEXT_LINE_SPACING = -3;
export const RULE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: 'Arial', fontSize: '10px', color: '#e8ecf5', align: 'left', lineSpacing: RULE_TEXT_LINE_SPACING }, 2);
export const SMALL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: 'Arial', fontSize: '18px', color: '#ffffff' };
// Hero circle's HP readout — bold + stroked (unlike statStyle's HUD text) since it sits directly
// over the circle's solid fill rather than the plain background the HUD corner text sits on.
export const HERO_HP_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: 'Arial Black', fontSize: '26px', color: '#ffffff' });
export const COST_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: 'Arial Black', fontSize: '14px', color: '#ffffff' });
// Repurposed as the bottom type banner's label (was small centered gray text) — white on a
// solid green bar now, see createCardContainer's 'full' mode.
export const TYPE_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: 'Arial', fontSize: '9px', color: '#9e9e9e', align: 'left' }, 0);
// Muted gold, distinct from TYPE_LABEL_STYLE's gray — footer's tribe segment (Rarity Dot -> Tribe -> Type), 'full' mode only, see CardView.createFooterBar.
export const TRIBE_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: 'Arial', fontSize: '9px', color: '#c9b37c', align: 'left' }, 0);
export const KEYWORD_LABEL_BASE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: 'Arial', fontSize: '10px', fontStyle: 'bold' }, 2);
// The ", " joining multiple keyword labels on their shared line — plain (unbolded, uncolored) so
// the colored keyword names stay the visual focus.
export const KEYWORD_SEPARATOR_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: 'Arial', fontSize: '10px', color: '#e8ecf5' }, 2);
export const MISSING_ASSET_STYLE: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: 'Arial', fontSize: '10px', color: '#888888', align: 'center', resolution: CARD_TEXT_RESOLUTION };
export const PILL_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = withStroke({ fontFamily: 'Arial', fontSize: '9px', color: '#ffffff', fontStyle: 'bold' }, 2);
// The atk/hp stat box (createStatBox, shared by 'full' and 'simplified') sits on an opaque white
// background, so the art-legibility stroke trick the rest of on-card text relies on would just look
// muddy here — plain dark text instead. The wounded variant (currentHealth !== maxHealth) recolors
// just the health digits red — everything else about the two styles must stay identical (font,
// size, resolution) since they render side-by-side in the same line.
export const STAT_FUSED_LIGHT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: 'Arial Black', fontSize: '16px', color: '#1a1a2e', resolution: CARD_TEXT_RESOLUTION };
export const STAT_FUSED_LIGHT_WOUNDED_STYLE: Phaser.Types.GameObjects.Text.TextStyle = { ...STAT_FUSED_LIGHT_STYLE, color: '#c0392b' };

// New card layout constants (createCardContainer) — starting points tuned by eye against
// src/refs/card-layout-ref-v1.png (superseded for 'full' mode by v2, see below), not pixel-perfect gospel.
export const HEADER_H = 30; // top band height, holding the title — shared by 'full' and 'simplified'
// CARD_W/CARD_H — see the comment there. The stat box's real size is ATKHP_BADGE_R below.
export const PILL_H = 14;
export const PILL_PAD_X = 5;
export const PILL_ROW_GAP = 3;
export const PILL_INSET_X = 6;
export const PILL_INSET_Y = 8; // 'simplified' mode's bottom-left keyword/trigger pill stack
export const PILL_RADIUS = 4; // keyword/status pill corner radius (b2)
// Extra top padding in the hover tooltip when it draws its own overflowing mana-cost badge (now the
// same gradient circle as the on-card one — see HelpBoxController.showHelpBox and COST_BADGE_R_FULL
// below) — tuned for that circle's height, not the old flat-blue box this replaced.
export const TOOLTIP_COST_CLEARANCE = 10;
export const TOOLTIP_BG_RADIUS = 6; // hover tooltip's rounded-corner background — matches DESC_BOX_RADIUS's "small, tuned by eye" scale, kept separate since the tooltip isn't drawn at card scale
export const TOOLTIP_TRIBE_GAP = 6; // gap between the tribe tag box and the mana-cost badge's left edge
export const TOOLTIP_TRIBE_PAD_X = 6; // horizontal text padding inside the tribe tag box
// Dark-on-white, unstroked — matches STAT_FUSED_LIGHT_STYLE's treatment of text on ATKHP_BADGE_COLOR's white fill, just sized for a short tag label rather than a stat digit.
export const TRIBE_TAG_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: 'Arial', fontSize: '12px', color: '#1a1a2e', resolution: CARD_TEXT_RESOLUTION };

export const OUTLINE_COLOR_TARGETABLE = 0xffd23f; // valid-target highlight (hero + board minions, AwaitingTarget) + the active player's hero-circle fill
export const OUTLINE_COLOR_READY = 0x38d97b; // "can act now" — board attack-ready minions AND hand playable cards
export const OUTLINE_COLOR_HOVER = 0x4fc3f7; // deck/graveyard pile hover
export const OUTLINE_COLOR_SICK = 0x888888; // summoning-sickness border (renderBoard) — static, not shimmered like the above: it's a passive status, not an actionable prompt
export const OUTLINE_COLOR_FROZEN = 0x6e95ac; // frozen-status border (renderBoard) — average RGB of textures/frozen-texture.jpg (via sharp .stats()), also static
export const OUTLINE_COLOR_TAPPED = 0x8a7048; // tapped-Aether border (renderAetherInPlay) — static, same treatment as SICK/FROZEN above, a dulled bronze so it doesn't read as either of those two statuses

// Per-category tint for Aether cards — the Aether-in-play row's per-category pile fills and any
// future category tag pill both key off this one map.
export const AETHER_CATEGORY_COLOR: Record<AetherCategory, number> = {
    fire: 0xe8563a,
    water: 0x3aa0e8,
    earth: 0x8a6d3a,
    air: 0xcfe8f0,
    generic: 0xb8c4d9,
};

// Same light/dark gradient-stop shape as COST_BADGE_LIGHT/DARK and RARITY_METADATA, one pair per
// category, hued off AETHER_CATEGORY_COLOR above — used by the elemental cost badge (CardView's
// createHeaderFull, HelpBoxController's tooltip badge) so it reads as "the same kind of badge" as
// the generic cost badge instead of the flatter category-pill treatment.
export const AETHER_CATEGORY_GRADIENT: Record<AetherCategory, { light: number; dark: number }> = {
    fire: { light: 0xff8a6b, dark: 0xb8331a },
    water: { light: 0x7fc8ff, dark: 0x1a6bb8 },
    earth: { light: 0xc2a06b, dark: 0x5c4620 },
    air: { light: 0xeaf7fb, dark: 0x9fc8d6 },
    generic: { light: 0xd8e0ee, dark: 0x8894a8 },
};

// Brief colored overlay flashed on a minion's card or hero's avatar the instant it takes damage or
// is healed — same in/out timing for both, only the color (and target shape) differs.
export const DAMAGE_FLASH_COLOR = 0xff2b2b;
export const HEAL_FLASH_COLOR = 0x3ddc84;
export const FLASH_IN_MS = 80; // quick punch-in
export const FLASH_OUT_MS = 220; // slightly slower fade-out

// Shimmer sweep tuning (addShimmeringOutline in index.ts) — the border is repainted every tick as
// a light→bright→light gradient along the bottom-left→top-right diagonal, with a bright band that
// sweeps that diagonal twice in quick succession, then pauses, then repeats.
export const SHIMMER_BRIGHTEN_AMOUNT = 0.95; // color lerp at the sweep's peak — 0 = unchanged border color, 1 = white
export const SHIMMER_BAND_WIDTH = 45; // falloff radius (px, along the diagonal) of the bright band around its peak
export const SHIMMER_SWEEP_MS = 900; // duration of a single bottom-left → top-right sweep
export const SHIMMER_PAUSE_MS = 1000; // pause after the 2 sweeps before the cycle repeats

// Flight-tilt tuning (cardFlightTilt.ts) — the fake-3D lean/squash/shadow applied to a card while
// it's mid-drag or mid-zone-transition (draw/play/death/snap-back). Kept small throughout since
// this is meant to read as a slight lift, not a cartoonish wobble.
export const FLIGHT_TILT_MAX_ROTATION_RAD = 0.08; // ~4.6°, added on top of a flight's own rotation
export const FLIGHT_TILT_MAX_SQUASH = 0.06; // up to 6% non-uniform scale, foreshortening cue
export const FLIGHT_TILT_SHADOW_MAX_ALPHA = 0.35; // trailing elevation shadow, peaks at max tilt
export const FLIGHT_TILT_SHADOW_OFFSET = 14; // px the shadow trails behind the tilt direction
export const FLIGHT_TILT_SMOOTHING = 0.3; // per-update lerp factor toward the new target tilt
// Pointer speed (px/ms) treated as "full" tilt intensity during live drag — above this the tilt
// is clamped at its max rather than growing further.
export const FLIGHT_TILT_DRAG_MAX_SPEED_REF = 1.6;

/** Blends `color` toward white by `amount` (0-1) — derives the shimmer's brighter tint from
 * whatever border color it's sweeping across, so a new color variant needs no separate lookup. */
export function lightenColor(color: number, amount: number): number {
    const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    const mix = (c: number) => Math.round(c + (255 - c) * amount);
    return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

// 'full' mode layout (v2 — src/refs/card-layout-ref-v2.jpg): the header and footer bars share one
// pre-authored PNG (the "rounded corners descending down the card's sides" shape is baked into its
// alpha channel — see createHeaderFull/createFooterBar) rather than hand-drawn Graphics, plus a
// semi-transparent rounded description box that grows upward from a fixed bottom anchor. The footer
// is the same asset rendered flipped vertically (Image.setFlipY), mirroring the header's descending
// corners into ascending ones — not a second file, since the shape is otherwise identical. The PNG
// is authored at 832px wide — the same native width as the card art (see CARD_W's comment) — so
// rendering it at CARD_W via fitWidth keeps it pixel-aligned with the art underneath; its *content*
// positioning (title/cost/dot/type/atk-hp text) is then tuned by eye against its "flat bar" region
// (the part that's opaque across the full width — the sides taper into transparency beyond that),
// like the rest of this file.
export const HEADER_FOOTER_BG_KEY = 'card-header-footer-bg';
const HEADER_FOOTER_BG_PATH = 'textures/card-header-footer-rounded-bg.png';

/**
 * Loads the header/footer background above — call from every Scene's `preload()` that renders
 * 'full' mode cards via CardView (currently `Preloader.ts` for the main game and
 * `CardCreatorPreview.ts` for the Card Creator's standalone Phaser.Game). Each Scene still needs its
 * own `load.image` call — Phaser's texture cache is per-Game, not shared across two separate
 * `Phaser.Game` instances — but centralizing the key+path here means there's exactly one place to
 * edit if the asset ever moves, instead of two call sites that can silently drift out of sync (as
 * happened once already: CardCreatorPreview.ts kept loading a pre-consolidation two-file version of
 * this asset under stale keys after Preloader.ts moved to this single flipped-reuse file, so
 * CardView's `textures.exists(HEADER_FOOTER_BG_KEY)` check silently failed and fell back to a plain
 * rectangle — only in the Card Creator preview, since the main game's Preloader.ts had been updated).
 */
export function loadHeaderFooterBg(scene: Phaser.Scene): void
{
    scene.load.image(HEADER_FOOTER_BG_KEY, HEADER_FOOTER_BG_PATH);
}

// Frozen-status overlay (renderBoard) — a translucent ice texture painted over a frozen minion's
// art. Board-only status chrome, so unlike HEADER_FOOTER_BG_KEY this is loaded by Preloader.ts only,
// not CardCreatorPreview.ts (which never renders board/frozen state).
export const FROZEN_TEXTURE_KEY = 'frozen-texture';
const FROZEN_TEXTURE_PATH = 'textures/frozen-texture.jpg';

export function loadFrozenTexture(scene: Phaser.Scene): void
{
    scene.load.image(FROZEN_TEXTURE_KEY, FROZEN_TEXTURE_PATH);
}

// Flat-bar height at CARD_W scale (86px @ 832px native) — title/cost text (header) and rarity
// dot/type/atk-hp (footer, flipped) center on this, not the full (taller, tapering) image height.
// One constant for both since they're now literally the same asset's shape, just mirrored.
export const HEADER_FOOTER_CONTENT_H = 16;
export const RARITY_DOT_R = 4;
export const RARITY_DOT_INSET = 8; // gap from the card's left/bottom edges to the dot's center
// Atk/hp stat badge (createStatBadge) — a circle centered on the card's bottom-right corner, the
// same corner-overflow treatment COST_BADGE_R_FULL above gets on the top-right corner (previously
// 'full' mode sat inset with no overflow at all; both modes overflow now). Smaller than the old
// dedicated rectangle (30x13, itself already a shrink from an even older 46x26).
//
// 'full' mode's badge (a1) was grown from its original radius-10 size, pinned so growth only
// extends left/up (into the card) rather than adding more right/bottom overflow — ATKHP_BADGE_CENTER_X/Y
// hold the circle's right/bottom extent fixed at that original radius-10 corner position (the
// literal `10` below is that fixed anchor, not a reference to ATKHP_BADGE_R, so it doesn't drift if
// the radius is tuned again), the same reasoning HAND_MIN_SPACING's comment gives for why the
// mana-cost badge can't just grow further right: a rightward hand neighbor paints over the card to
// its left, so pushing overflow further right risks the badge getting hidden under it.
export const ATKHP_BADGE_R = 14;
export const ATKHP_BADGE_CENTER_X = CARD_W / 2 + 10 - ATKHP_BADGE_R;
export const ATKHP_BADGE_CENTER_Y = CARD_H / 2 + 10 - ATKHP_BADGE_R;
export const ATKHP_BADGE_COLOR = 0xffffff; // fill — flat, not gradient, unlike the mana badge; edit here

// Board-only badge (b1) — plain corner-centered (no pin — the board row doesn't pack cards as
// tightly as a hand fan, so there's no equivalent overflow-collision risk to avoid), a touch bigger
// than 'full' mode's now-grown badge above; createStatusPills' rowLimitX must stay in sync with
// this (it reserves this exact radius' worth of space so pills never run into the badge).
export const ATKHP_BADGE_R_SIMPLIFIED = ATKHP_BADGE_R + 2;
export const DESC_BOX_RADIUS = 5;
// Rarity-gradient border stroked around the description box (a2) — see createDescriptionBox.
export const DESC_BOX_BORDER_WIDTH = 1;
export const DESC_BOX_INSET_X = 4; // gap from the card's left/right edges to the description box
export const DESC_BOX_PAD_Y = 6; // internal top/bottom padding between the box edge and its text
export const DESC_BOX_KEYWORD_LINE_H = 14; // fixed height budgeted for the keyword line, matching createKeywordLabels' font metrics
export const DESC_BOX_LINE_GAP = 2; // gap between the keyword line and the rule text below it
// Fixed bottom anchor the description box's *content* (text) is pinned to — see
// createDescriptionBox. Deliberately a literal, not derived from HEADER_FOOTER_CONTENT_H — the
// box's drawn background is separately stretched down past this anchor to CARD_H / 2 so it visually
// continues behind the footer bar (which paints over it on top), but that must never move where the
// text itself lands, so the two are intentionally decoupled.
export const DESC_BOX_BOTTOM_Y = CARD_H / 2 - 18;

// Header's mana-cost badge — centered exactly on the card's top-right corner so it deliberately
// overflows both edges (bringing back the pre-v2 treatment, see createHeaderFull), rendered over the
// header background as a diagonal-gradient circle (Phaser has no native radial fill — same
// approximation the footer's rarity dot below uses) since the header PNG no longer bakes in its own
// mana-cost decoration.
export const COST_BADGE_R_FULL = 12;
export const COST_BADGE_LIGHT = 0xb08cf0;
export const COST_BADGE_DARK = 0x5a1fa0;
export const COST_BADGE_STROKE_COLOR = 0x000000;
export const COST_BADGE_STROKE_WIDTH = 1.5;

// The generic-Aether pool marker (renderAetherMarker) — same COST_BADGE_LIGHT/DARK gradient
// circle + stroke recipe as the on-card cost badge above, just bigger, since it's the sole
// stand-in for a whole pile rather than a small corner decoration.
export const AETHER_MARKER_R = 20;

// 'simplified' mode's paid-ability badge(s) (CardView.abilityBadgeLayout/createAbilityBadges) —
// 'simplified' mode renders no mana-cost badge at all, so the top-right corner COST_BADGE_R_FULL
// otherwise occupies in 'full' mode is free; reusing that exact radius/position/gradient recipe
// there reads as "the same kind of badge" without inventing new visual language. A minion with more
// than one paid ability stacks additional badges downward along the right edge, this gap apart.
export const ABILITY_BADGE_GAP = 4;
// Applied to an unaffordable ability badge (both on-card and its matching click zone in renderBoard,
// which must independently gate interactivity — a minion's own paidAbilities check silently no-ops
// on insufficient mana, same as every other silent-rejection case CLAUDE.md documents).
export const ABILITY_BADGE_DIM_ALPHA = 0.4;

/** The off-board card zones that get a pile visual and a click-to-inspect overlay. */
export type PileZone = 'deck' | 'graveyard' | 'aetherDeck';

/**
 * How createCardContainer renders a card. 'full' is the detailed layout (hand, deck/graveyard
 * pile view, the played-card spotlight) — full-bleed art with a header/footer PNG (title top-left;
 * gradient-circle mana-cost badge, COST_BADGE_*, centered on the top-right corner so it overflows
 * both edges), a semi-transparent rounded description box (keyword labels then rule text) that
 * grows upward from a fixed bottom anchor so its last line always lands in the same place, and a
 * footer (gradient-filled rarity dot + type text, plus the atk/hp badge below). 'simplified' is the
 * battlefield-only layout — same full-bleed art and gradient header/title, but no cost badge, no
 * description box/footer PNG; a minion's keywords and triggered-effect flavor words instead render
 * as compact bottom-left pills (see createStatusPills), to keep the cramped board row as
 * clutter-free as possible. The atk/hp badge (createStatBadge) is built by shared code in both
 * modes — a flat-white circle centered on the bottom-right corner so it overflows both edges, the
 * same corner-badge treatment the mana-cost circle gets on the opposite corner — but not the same
 * size: 'full' mode uses ATKHP_BADGE_R (pinned so growth only extends left/up, see its own comment),
 * 'simplified' mode uses the separate, slightly larger ATKHP_BADGE_R_SIMPLIFIED. 'faceDown' is the
 * card-back, used for the opponent's hand and its matching draw-animation preview.
 */
export type CardDisplayMode = 'full' | 'simplified' | 'faceDown';

export function statStyle(color: string, stroke = false, fontSize = '20px'): Phaser.Types.GameObjects.Text.TextStyle {
    const base: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: 'Arial Black', fontSize, color };
    return stroke ? withStroke(base) : base;
}

/** Per-zone pile chrome. The deck keeps the card-back blue it has always used; the graveyard takes a desaturated maroon so the two read apart at a glance in the same column. `title` is the pile-inspect overlay's heading (PileViewController) — the board's own pile visual carries no text label. */
export const PILE_STYLES: Record<PileZone, { fill: number; stroke: number; title: string }> = {
    deck: { fill: 0x24304a, stroke: 0x8fa8d6, title: 'Deck' },
    graveyard: { fill: 0x33262c, stroke: 0xc08a94, title: 'Graveyard' },
    aetherDeck: { fill: 0x3a2f5c, stroke: 0xb08fd6, title: 'Aether Deck' },
};

/** The cards currently sitting in a player's deck, graveyard, or Aether Deck — shared by the board's pile visual (renderPile) and the pile-inspect overlay (PileViewController), so both read the same zone the same way. */
export function getPileCards(playerState: PlayerState, zone: PileZone): CardInstance[]
{
    if (zone === 'deck') return playerState.deck;
    if (zone === 'aetherDeck') return playerState.aetherDeck;
    return playerState.graveyard;
}

/**
 * The full-screen dimmed backdrop + heading + close button + hint text shared by every full-
 * screen card-grid overlay (PileViewController's pile inspect, CardPickerController's card
 * picker) — genuinely identical boilerplate between the two, only the title text and dismiss
 * callback differ; everything else about the two overlays (what cards they show, how they're laid
 * out, what a click does) is different enough to be worth keeping separate. Returns the created
 * objects so the caller can push them onto its own cleanup list — this helper doesn't track or own
 * them itself.
 */
export function createOverlayChrome(scene: Phaser.Scene, title: string, onDismiss: () => void): {
    dimmer: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    close: Phaser.GameObjects.Text;
    hint: Phaser.GameObjects.Text;
}
{
    // Interactive so a click anywhere off a card dismisses the view — and, more importantly, so
    // the board underneath cannot be clicked through it. Phaser's InputPlugin is topOnly by
    // default, so this full-screen rect swallows every pointer event below PILE_VIEW_DEPTH.
    const dimmer = scene.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82)
        .setDepth(PILE_VIEW_DEPTH)
        .setInteractive();
    dimmer.on('pointerup', () => onDismiss());

    const titleText = scene.add.text(CENTER_X, 52, title, {
        fontFamily: 'Arial Black', fontSize: '36px', color: '#ffffff',
    }).setOrigin(0.5, 0).setDepth(PILE_VIEW_DEPTH + 1);

    const close = scene.add.text(GAME_WIDTH - 48, 52, '✕ Close', {
        fontFamily: 'Arial', fontSize: '24px', color: '#ffffff', backgroundColor: '#3a4a6b',
    }).setOrigin(1, 0).setPadding(16, 9, 16, 9).setDepth(PILE_VIEW_DEPTH + 1).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => onDismiss());

    const hint = scene.add.text(CENTER_X, GAME_HEIGHT - 34, 'Click anywhere or press Esc to close', {
        fontFamily: 'Arial', fontSize: '16px', color: '#8fa8d6',
    }).setOrigin(0.5, 1).setDepth(PILE_VIEW_DEPTH + 1);

    return { dimmer, title: titleText, close, hint };
}

/**
 * CSS `background-size: cover; background-position: center` for a Phaser Image — fills exactly
 * width x height with no stretching, cropping whichever axis overflows and keeping the crop
 * centered. Crops the *source* texture to the target aspect ratio first (in texture pixels, via
 * setCrop), then scales uniformly so that cropped region ends up exactly width x height.
 *
 * Deliberately does NOT finish with `image.setDisplaySize(width, height)` despite that being the
 * obvious-looking call — per Phaser's own Crop component docs, "cropping ... does not change its
 * size, dimensions" (Components/Crop.js), meaning setDisplaySize scales relative to the image's
 * full *uncropped* frame, not the crop rectangle. Calling it directly here silently distorts
 * (non-uniform scaleX/scaleY) any time a real crop happens — invisible for years because every
 * caller happened to pass a target aspect ratio matching the source exactly (card art's fixed 2:3
 * matching CARD_W:CARD_H, the card-back texture), so cropW/cropH always coincidentally equaled the
 * full frame and no real crop ever occurred. First real crop (CardView's artVerticalAlign, which
 * intentionally requests a shorter-than-2:3 box) exposed it. Scaling by width/cropW instead (equal
 * to height/cropH by construction, since the crop's aspect always matches the target's) is uniform
 * regardless of whether a crop actually happened, and is a no-op change for every existing
 * no-crop-needed caller. Shared by CardView's card art and CardGame's deck-pile card-back image —
 * the only two places that render a texture into a fixed box.
 */
export function coverFit(image: Phaser.GameObjects.Image, width: number, height: number): void
{
    const sourceW = image.width;
    const sourceH = image.height;
    const targetAspect = width / height;

    let cropW: number;
    let cropH: number;

    if (sourceW / sourceH > targetAspect)
    {
        cropW = sourceH * targetAspect;
        cropH = sourceH;
        image.setCrop((sourceW - cropW) / 2, 0, cropW, cropH);
    }
    else
    {
        cropW = sourceW;
        cropH = sourceW / targetAspect;
        image.setCrop(0, (sourceH - cropH) / 2, cropW, cropH);
    }

    image.setScale(width / cropW);
}

/**
 * Scales a Phaser Image to an exact target width, preserving its native aspect ratio (no crop) —
 * unlike coverFit, which fills a fixed box by cropping. Used for the 'full' mode header/footer PNGs
 * (createHeaderFull/createFooterBar), which are authored at CARD_W's native art resolution (832px
 * wide) and must render at their real proportions, alpha-shaped edges included, rather than being
 * force-fit into a hand-picked box.
 */
export function fitWidth(image: Phaser.GameObjects.Image, width: number): void
{
    const scale = width / image.width;
    image.setDisplaySize(width, image.height * scale);
}
