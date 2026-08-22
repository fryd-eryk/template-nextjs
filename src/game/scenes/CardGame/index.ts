import { Geom, Scene } from 'phaser';

import { decideOpponentAction, decideOpponentTarget } from '../../ai/OpponentAI';
import { CARD_DEFINITIONS } from '../../data/cards';
import { generateAetherDeck, generateDeck } from '../../data/deckGenerator';
import { KEYWORD_METADATA } from '../../data/keywordMetadata';
import { EventBus } from '../../EventBus';
import { canAffordAetherCost, countUntappedPlain } from '../../state/aether';
import { resolveCardText } from '../../state/counters';
import { canDeclareAttack, hasKeyword } from '../../state/keywordRules';
import { createInitialState } from '../../state/createInitialState';
import { isDeckLegal, loadDecks, pickRandomLegalDeck } from '../../state/deckStorage';
import { getPlayerDeckForMatch } from '../../state/matchSetup';
import { TurnStateMachine } from '../../state/TurnStateMachine';
import type { AetherCategory, EffectAction } from '../../types/Card';
import type { PlayerId } from '../../types/common';
import type { GameState, PendingTarget, PlayerState } from '../../types/GameState';
import { TurnPhase } from '../../types/GameState';
import {
    AETHER_CATEGORY_COLOR,
    AETHER_MARKER_OFFSET_X,
    AETHER_MARKER_R,
    AETHER_PILE_X,
    AETHER_ROW_SPACING,
    AETHER_ROW_X_START,
    BOARD_ZONE_W,
    CARD_BACK_AETHER_KEY,
    CARD_BACK_KEY,
    CARD_H,
    CARD_W,
    CENTER_X,
    CENTER_Y,
    coverFit,
    COST_BADGE_DARK,
    COST_BADGE_LIGHT,
    COST_BADGE_R_FULL,
    COST_BADGE_STROKE_COLOR,
    COST_BADGE_STROKE_WIDTH,
    DAMAGE_FLASH_COLOR,
    DECK_PILE_H,
    DECK_PILE_W,
    FLASH_IN_MS,
    FLASH_OUT_MS,
    GAME_HEIGHT,
    GAME_WIDTH,
    getPileCards,
    HAND_ARC_ANGLE_STEP_DEG,
    HAND_ARC_LIFT,
    HAND_ARC_MAX_ANGLE_DEG,
    HAND_DROP_ZONE_H,
    HAND_DROP_ZONE_W,
    HAND_MIN_SPACING,
    HAND_PEEK_DEPTH,
    HAND_PEEK_HOVER_MARGIN,
    HEAL_FLASH_COLOR,
    HERO_DEPTH,
    HERO_HP_STYLE,
    HERO_RADIUS,
    HERO_SIZE,
    lightenColor,
    OPPONENT_AETHER_DECK_Y,
    OPPONENT_AETHER_ROW_START_Y,
    OPPONENT_BOARD_Y,
    OPPONENT_DECK_Y,
    OPPONENT_GRAVEYARD_Y,
    OPPONENT_HAND_Y,
    OPPONENT_HERO_Y,
    OUTLINE_COLOR_FROZEN,
    OUTLINE_COLOR_HOVER,
    OUTLINE_COLOR_READY,
    OUTLINE_COLOR_SICK,
    OUTLINE_COLOR_TAPPED,
    OUTLINE_COLOR_TARGETABLE,
    PILE_STYLES,
    PILE_X,
    PLAYER_AETHER_DECK_Y,
    PLAYER_AETHER_ROW_START_Y,
    PLAYER_BOARD_Y,
    PLAYER_DECK_Y,
    PLAYER_GRAVEYARD_Y,
    PLAYER_HAND_PEEK_Y,
    PLAYER_HAND_POKE_Y,
    PLAYER_HERO_Y,
    type PileZone,
    SHIMMER_BAND_WIDTH,
    SHIMMER_BRIGHTEN_AMOUNT,
    SHIMMER_PAUSE_MS,
    SHIMMER_SWEEP_MS,
    SMALL_STYLE,
    SPOTLIGHT_X,
    statStyle,
    TOOLTIP_BG_RADIUS,
} from './cardLayout';
import { beginFlightTilt, endFlightTilt, type FlightTiltHandle, updateFlightTilt, updateFlightTiltFromPointer } from './cardFlightTilt';
import { CardView } from './CardView';
import { HelpBoxController } from './HelpBoxController';
import { CardPickerController } from './CardPickerController';
import { PileViewController } from './PileViewController';

/** A hand card's idle "slot" — its arced position/rotation/scale/depth when nothing is happening to it. See handCardSlot. */
type HandSlot = { x: number; y: number; rotation: number; scale: number; depth: number };

/**
 * A hand card's static peek-hover trigger rectangle (world space) plus its enter/leave callbacks
 * and current state — see the scene-level 'pointermove' listener registered in create() and the
 * comment above renderHand's population of this.handPeekZones for why this is driven by a manual
 * geometry check rather than Phaser's own per-object pointerover/pointerout events.
 */
type HandPeekZone = { left: number; right: number; top: number; bottom: number; peeked: boolean; peekIn: () => void; peekOut: () => void };

/**
 * Renders TurnStateMachine's GameState and forwards input into it. This scene owns no
 * game rules of its own — every button/drag/click just calls a TurnStateMachine method.
 *
 * TurnStateMachine resolves a whole action (mutation + effects + death sweep) synchronously
 * within a single call, emitting 'state:phase-change' plus action-specific events
 * ('state:card-played', 'state:attack', 'state:card-died', 'state:card-drawn') along the way —
 * all before this Scene ever gets a turn to run a tween. So the board is NOT rebuilt on every
 * phase-change: renderNow() (the full teardown/rebuild) only actually runs for "settled" phases
 * (see RENDERABLE_PHASES), and is deferred behind requestRender()'s isAnimating gate whenever an
 * action-specific event has queued an animation. Those queued animations run against whatever
 * renderNow() last actually painted — which, since GameState is already fully resolved by then,
 * is always the correct "before" picture for a move/fade/fly tween — and only once the queue
 * drains does the deferred renderNow() finally paint the true final state.
 *
 * Because a trigger effect (Anthem/Deathcry/Channel/Muster/Mourn) resolves synchronously as part
 * of the very same TurnStateMachine call, its own events ('state:card-drawn', 'state:damaged',
 * 'state:healed', 'state:card-died') always fire *before* the action's own wrapping event
 * ('state:card-played'/'state:attack'). Playing them in that raw firing order would show the
 * trigger's animation (e.g. a Deathcry draw) before the card has even finished visibly moving.
 * So — other than the death fade, which is genuinely reused mid-sequence by playAttackAnimation —
 * card-drawn/damaged/healed/died handlers only buffer into pendingDrawIds/pendingDamageIds/
 * pendingHealIds/pendingDeathIds; playCardPlayedAnimation/playAttackAnimation explicitly flush
 * those buffers themselves once their own displacement (and any resulting death fade) has fully
 * played out, and requestRender() flushes them the same way for actions with no displacement
 * animation of their own (turn-start Vigil draws, paid abilities, the debug draw cheat).
 *
 * Card visuals are built by CardView, the hover tooltip by HelpBoxController, and the
 * deck/graveyard inspect overlay by PileViewController — see those files for the display
 * layouts. This class owns the render pass that places their output (renderHero/renderPile/
 * renderHand/renderBoard/renderNow) and the animation choreography, since both directly mutate
 * this scene's core bookkeeping (instanceContainers, renderedObjects, heroContainers).
 */
export class CardGame extends Scene
{
    private static readonly RENDERABLE_PHASES: ReadonlySet<TurnPhase> = new Set([
        TurnPhase.MainIdle,
        TurnPhase.AwaitingTarget,
        TurnPhase.GameOver,
    ]);

    private machine!: TurnStateMachine;

    private cardView!: CardView;
    private helpBoxController!: HelpBoxController;
    private pileView!: PileViewController;
    private cardPicker!: CardPickerController;

    private renderedObjects: Phaser.GameObjects.GameObject[] = [];
    private cardInstanceByContainer = new Map<Phaser.GameObjects.Container, string>();
    // Every non-face-down player hand card's idle arced slot (see handCardSlot) — both the
    // peek-out tween and a cancelled drag restore a card to exactly this, so there's one source
    // of truth for "where does this card live when nothing is happening to it."
    private handSlots = new Map<Phaser.GameObjects.Container, HandSlot>();
    // Drives peek hover — see create()'s single 'pointermove' listener and renderHand's
    // population of this map for why it's a manual geometry check instead of Phaser's own
    // per-object pointerover/pointerout (which silently breaks under topOnly input priority once
    // two overlapping interactive objects, the card and its hover-padding, are both in play).
    private handPeekZones = new Map<Phaser.GameObjects.Container, HandPeekZone>();
    private instanceContainers = new Map<string, Phaser.GameObjects.Container>();
    private heroContainers = new Map<PlayerId, Phaser.GameObjects.Container>();

    private turnBannerText!: Phaser.GameObjects.Text;
    private endTurnButton!: Phaser.GameObjects.Container;
    private cancelButton!: Phaser.GameObjects.Container;
    private drawCardButton!: Phaser.GameObjects.Container;
    private fullManaButton!: Phaser.GameObjects.Container;
    // Named targeting prompt ("Choose a target for Silence") — centered under the spotlighted
    // card while one's held (see playTargetBeginAnimation), or screen-centered otherwise (attack's
    // own target step, a board-wide Channel/Muster/Vigil/Curfew reaction, a paid ability). Same
    // visual treatment as HelpBoxController's tooltip background — see updateTargetPromptBox.
    private targetPromptBox!: Phaser.GameObjects.Container;
    private targetPromptBg!: Phaser.GameObjects.Graphics;
    private targetPromptText!: Phaser.GameObjects.Text;

    // The hand card currently being dragged, if any — excluded from per-card peek handling (see
    // the 'pointermove' listener in create() that walks handPeekZones) so a peek firing mid-drag
    // can't fight the drag handler's own per-pointermove setPosition() on the same container.
    // Without this the card visibly detached from the cursor, stuttering between the tween's
    // eased position and the drag's direct one every frame.
    private draggedContainer: Phaser.GameObjects.Container | null = null;

    // The dragged card's flight-tilt handle, if any (see wireDragEvents) — keyed by container
    // rather than a single field since a fast cancel-then-redrag could in principle overlap a
    // not-yet-cleaned-up handle from the previous drag.
    private flightTiltHandles = new Map<Phaser.GameObjects.Container, FlightTiltHandle>();

    // --- animation orchestration --------------------------------------------------

    private animQueue: Array<() => Promise<void>> = [];
    private isAnimating = false;
    private renderQueued = false;
    private pendingDeathIds: { instanceId: string; playerId: PlayerId }[] = [];
    private pendingDamageIds: string[] = [];
    private pendingHealIds: string[] = [];
    // Buffered like pendingDeathIds/pendingDamageIds/pendingHealIds rather than enqueued straight
    // off cardDrawnHandler — a trigger effect (Anthem/Deathcry/Channel/Muster/Mourn draw) resolves
    // and emits 'state:card-drawn' *before* the action's own wrapping event ('state:card-played'/
    // 'state:attack'), since TurnStateMachine runs mutation+effects synchronously start to finish.
    // Buffering lets playCardPlayedAnimation/playAttackAnimation flush it themselves once their own
    // displacement (and any resulting death fade) animation has fully played out, instead of the
    // draw animation jumping the queue and playing first — see playPendingDraws.
    private pendingDrawIds: { playerId: PlayerId; instanceId: string }[] = [];

    private phaseChangeHandler = (phase: TurnPhase): void =>
    {
        if (!CardGame.RENDERABLE_PHASES.has(phase)) return;
        // Chrome (banner text, health/mana, End Turn/Cancel) is cheap and carries no stale
        // container references, so it updates immediately even mid-animation — otherwise e.g.
        // the Cancel button and "choose a target" banner would linger on screen throughout an
        // attack's lunge, since the full board rebuild that would normally clear them is deferred.
        this.updateChrome(this.machine.state);
        this.requestRender();
    };

    private cardDrawnHandler = ({ playerId, instanceId }: { playerId: PlayerId; instanceId: string }): void =>
    {
        this.pendingDrawIds.push({ playerId, instanceId });
    };

    private cardPlayedHandler = ({ instanceId, playerId }: { instanceId: string; playerId: PlayerId }): void =>
    {
        this.enqueueAnimation(() => this.playCardPlayedAnimation(instanceId, playerId));
    };

    private attackHandler = ({ attackerInstanceId, targetId }: { attackerInstanceId: string; targetId: string }): void =>
    {
        this.enqueueAnimation(() => this.playAttackAnimation(attackerInstanceId, targetId));
    };

    private cardDiedHandler = ({ instanceId, playerId }: { instanceId: string; playerId: PlayerId }): void =>
    {
        this.pendingDeathIds.push({ instanceId, playerId });
    };

    private damagedHandler = ({ targetId }: { targetId: string }): void =>
    {
        if (!this.pendingDamageIds.includes(targetId)) this.pendingDamageIds.push(targetId);
    };

    private healedHandler = ({ targetId }: { targetId: string }): void =>
    {
        if (!this.pendingHealIds.includes(targetId)) this.pendingHealIds.push(targetId);
    };

    // Only the human player's own hand cards get the held-at-spotlight treatment — see renderHand's
    // heldInstanceId/heldCard and TurnStateMachine's matching emits for why playerId is checked here.
    private targetBeginHandler = ({ instanceId, playerId }: { instanceId: string; playerId: PlayerId }): void =>
    {
        if (playerId !== 'player') return;
        this.enqueueAnimation(() => this.playTargetBeginAnimation(instanceId));
    };

    private targetCancelledHandler = ({ instanceId, playerId }: { instanceId: string; playerId: PlayerId }): void =>
    {
        if (playerId !== 'player') return;
        this.enqueueAnimation(() => this.playTargetCancelledAnimation(instanceId));
    };

    /** Queues an animation step and kicks off draining if nothing is already running. */
    private enqueueAnimation (step: () => Promise<void>): void
    {
        this.animQueue.push(step);
        if (this.isAnimating) return;
        this.isAnimating = true;
        void this.drainQueue();
    }

    private async drainQueue (): Promise<void>
    {
        while (this.animQueue.length > 0)
        {
            const step = this.animQueue.shift()!;
            await step();
        }
        this.isAnimating = false;
        if (this.renderQueued)
        {
            this.renderQueued = false;
            this.renderNow();
        }
    }

    /** Renders immediately unless an animation is in flight, in which case the render is deferred until it drains. */
    private requestRender (): void
    {
        if (this.pendingDamageIds.length > 0 && !this.isAnimating)
        {
            this.enqueueAnimation(() => this.playPendingDamageFlashes());
        }
        if (this.pendingHealIds.length > 0 && !this.isAnimating)
        {
            this.enqueueAnimation(() => this.playPendingHealFlashes());
        }
        if (this.pendingDeathIds.length > 0 && !this.isAnimating)
        {
            this.enqueueAnimation(() => this.playPendingDeaths());
        }
        if (this.pendingDrawIds.length > 0 && !this.isAnimating)
        {
            this.enqueueAnimation(() => this.playPendingDraws());
        }
        if (this.isAnimating)
        {
            this.renderQueued = true;
            return;
        }
        this.renderNow();
    }

    /** Wraps a player-input callback so clicks/drops during an in-flight animation are ignored rather than firing on stale, about-to-be-replaced containers. */
    private guarded (fn: () => void): () => void
    {
        return () => { if (!this.isAnimating) fn(); };
    }

    private tweenPromise (config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void>
    {
        return new Promise((resolve) =>
        {
            this.tweens.add({ ...config, onComplete: () => resolve() });
        });
    }

    private delay (ms: number): Promise<void>
    {
        return new Promise((resolve) => { this.time.delayedCall(ms, () => resolve()); });
    }

    private deckPilePosition (playerId: PlayerId): { x: number; y: number }
    {
        return { x: PILE_X, y: playerId === 'opponent' ? OPPONENT_DECK_Y : PLAYER_DECK_Y };
    }

    private aetherDeckPilePosition (playerId: PlayerId): { x: number; y: number }
    {
        return { x: AETHER_PILE_X, y: playerId === 'opponent' ? OPPONENT_AETHER_DECK_Y : PLAYER_AETHER_DECK_Y };
    }

    private graveyardPilePosition (playerId: PlayerId): { x: number; y: number }
    {
        return { x: PILE_X, y: playerId === 'opponent' ? OPPONENT_GRAVEYARD_Y : PLAYER_GRAVEYARD_Y };
    }

    private resolveTargetContainer (targetId: string): Phaser.GameObjects.Container | undefined
    {
        return targetId === 'player' || targetId === 'opponent'
            ? this.heroContainers.get(targetId as PlayerId)
            : this.instanceContainers.get(targetId);
    }

    /** Flies every card queued up by cardDiedHandler since the last flush to its own owner's
     * graveyard pile, fading out en route — 500ms per card, all in parallel (each can belong to a
     * different player, e.g. a board-wipe hitting both sides at once, so unlike playPendingDraws
     * these don't share a single destination and don't need to be serialized). */
    private async playPendingDeaths (): Promise<void>
    {
        if (this.pendingDeathIds.length === 0) return;

        const dying = this.pendingDeathIds.splice(0, this.pendingDeathIds.length);
        await Promise.all(dying.map(async ({ instanceId, playerId }) =>
        {
            const container = this.instanceContainers.get(instanceId);
            if (!container) return;

            const dest = this.graveyardPilePosition(playerId);
            const origin = { x: container.x, y: container.y };
            const handle = beginFlightTilt(this, container);

            await this.tweenPromise({
                targets: container, x: dest.x, y: dest.y, alpha: 0, duration: 500, ease: 'Cubic.easeIn',
                onUpdate: (tween) => updateFlightTilt(handle, dest.x - origin.x, dest.y - origin.y, Math.sin(tween.progress * Math.PI)),
            });

            endFlightTilt(handle);
        }));
    }

    /** Plays every draw queued up by cardDrawnHandler since the last flush, one at a time — see
     * pendingDrawIds' doc comment for why these are buffered instead of animated immediately.
     * Sequential rather than parallel since each draw reflows the whole hand row (playDrawAnimation
     * re-tweens every sibling to its new slot), so overlapping draws would fight over positions. */
    private async playPendingDraws (): Promise<void>
    {
        if (this.pendingDrawIds.length === 0) return;

        const draws = this.pendingDrawIds.splice(0, this.pendingDrawIds.length);
        for (const { playerId, instanceId } of draws)
        {
            await this.playDrawAnimation(playerId, instanceId);
        }
    }

    /** Briefly overlays `color` on every target id's container (minion instanceId or hero PlayerId) — a full-card rectangle for a minion, a circle matching the avatar for a hero — run in parallel across every id given. Shared by the damage (red) and heal (green) flash flushers below. */
    private async flashOverlay (ids: string[], color: number): Promise<void>
    {
        await Promise.all(ids.map(async (id) =>
        {
            const container = this.resolveTargetContainer(id);
            if (!container) return;

            const isHero = id === 'player' || id === 'opponent';
            const overlay = isHero
                ? this.add.circle(0, 0, HERO_RADIUS, color).setAlpha(0)
                : this.add.rectangle(0, 0, CARD_W, CARD_H, color).setAlpha(0);
            container.add(overlay);
            await this.tweenPromise({ targets: overlay, alpha: 0.6, duration: FLASH_IN_MS, ease: 'Linear' });
            await this.tweenPromise({ targets: overlay, alpha: 0, duration: FLASH_OUT_MS, ease: 'Linear' });
            overlay.destroy();
        }));
    }

    /** Flashes every target id queued up by damagedHandler since the last flush — a brief red overlay. */
    private async playPendingDamageFlashes (): Promise<void>
    {
        if (this.pendingDamageIds.length === 0) return;
        const ids = this.pendingDamageIds.splice(0, this.pendingDamageIds.length);
        await this.flashOverlay(ids, DAMAGE_FLASH_COLOR);
    }

    /** Flashes every target id queued up by healedHandler since the last flush — a brief green overlay. */
    private async playPendingHealFlashes (): Promise<void>
    {
        if (this.pendingHealIds.length === 0) return;
        const ids = this.pendingHealIds.splice(0, this.pendingHealIds.length);
        await this.flashOverlay(ids, HEAL_FLASH_COLOR);
    }

    /** Attacker lunges at its target (easing in — slow start, speed ramping up), flashes any resulting damage, then returns to its original spot, before any resulting deaths fade and any resulting draws (e.g. Grave Warden's Deathcry) play — see pendingDrawIds. */
    private async playAttackAnimation (attackerInstanceId: string, targetId: string): Promise<void>
    {
        const attacker = this.instanceContainers.get(attackerInstanceId);
        const target = this.resolveTargetContainer(targetId);

        if (attacker && target)
        {
            const origin = { x: attacker.x, y: attacker.y };
            attacker.setDepth(1500);

            await this.tweenPromise({ targets: attacker, x: target.x, y: target.y, duration: 260, ease: 'Cubic.easeIn' });
            void this.playPendingDamageFlashes();
            void this.playPendingHealFlashes();
            await this.tweenPromise({ targets: attacker, x: origin.x, y: origin.y, duration: 200, ease: 'Cubic.easeOut' });
        }

        await this.playPendingDeaths();
        await this.playPendingDraws();
    }

    /**
     * Spotlights a just-played card at the screen's left-center so the player can register what
     * was played, then — without waiting on any input — flies it out to its resting place: its
     * computed board slot for a minion that was actually summoned, or a fade-out for a spell or a
     * minion discarded to a full board. Only once that's fully settled (and any resulting deaths
     * have faded) does any Anthem/Channel/Muster draw play — see pendingDrawIds.
     */
    private async playCardPlayedAnimation (instanceId: string, playerId: PlayerId): Promise<void>
    {
        let container = this.instanceContainers.get(instanceId);
        if (!container)
        {
            await this.playPendingDeaths();
            await this.playPendingDraws();
            return;
        }

        // The container we just found is whatever the last renderHand() built — for the
        // opponent that's always the face-down version (swap in a face-up one so the player can
        // actually see what was played), and for the player it's whatever hand-only decoration
        // (the playable glow outline, an idle arc rotation dragend didn't get a chance to clear —
        // see wireDragEvents' isAnimating guard) that container happened to carry. Rebuilding
        // fresh for both sides is simplest: a plain 'full' card has neither, and it's about to fly
        // off to the spotlight anyway, so nothing about the hand container is worth keeping.
        {
            const player = this.machine.state.players[playerId];
            const instance = player.board.find((c) => c.instanceId === instanceId)
                ?? player.graveyard.find((c) => c.instanceId === instanceId);
            if (instance)
            {
                const revealed = this.cardView.createCardContainer(instance, 'full', undefined, false, false, resolveCardText(instance, this.machine.state));
                revealed.setPosition(container.x, container.y);

                const index = this.renderedObjects.indexOf(container);
                if (index !== -1) this.renderedObjects[index] = revealed;
                else this.renderedObjects.push(revealed);

                container.destroy();
                this.instanceContainers.set(instanceId, revealed);
                container = revealed;
            }
        }

        container.setDepth(2500);

        // One continuous flight across both legs (hand→spotlight, then spotlight→board) — scale
        // is tween-driven throughout (1.25 at the spotlight, back to 1 on landing), rotation isn't
        // touched by either leg so it stays owned by the handle's fixed (0) base.
        const spotlightOrigin = { x: container.x, y: container.y };
        const handle = beginFlightTilt(this, container, { scaleDriven: true });
        await this.tweenPromise({
            targets: container, x: SPOTLIGHT_X, y: CENTER_Y, scale: 1.25, duration: 350, ease: 'Cubic.easeOut',
            onUpdate: (tween) => updateFlightTilt(handle, SPOTLIGHT_X - spotlightOrigin.x, CENTER_Y - spotlightOrigin.y, Math.sin(tween.progress * Math.PI)),
        });
        await this.delay(550);

        const destination = this.computePlayedCardDestination(instanceId, playerId);
        if (destination)
        {
            const boardOrigin = { x: container.x, y: container.y };
            await this.tweenPromise({
                targets: container, x: destination.x, y: destination.y, scale: 1, duration: 350, ease: 'Cubic.easeIn',
                onUpdate: (tween) => updateFlightTilt(handle, destination.x - boardOrigin.x, destination.y - boardOrigin.y, Math.sin(tween.progress * Math.PI)),
            });
            endFlightTilt(handle);
        }
        else
        {
            endFlightTilt(handle);
            await this.tweenPromise({ targets: container, alpha: 0, duration: 300, ease: 'Linear' });
        }

        void this.playPendingDamageFlashes();
        void this.playPendingHealFlashes();
        await this.playPendingDeaths();
        await this.playPendingDraws();
    }

    /** Board slot the just-played card settled into, using the same row-layout math as renderBoard — or undefined if it never made it to the board (spell, or a full-board discard). */
    private computePlayedCardDestination (instanceId: string, playerId: PlayerId): { x: number; y: number } | undefined
    {
        const board = this.machine.state.players[playerId].board;
        const index = board.findIndex((c) => c.instanceId === instanceId);
        if (index === -1) return undefined;

        const { spacing, startX } = this.rowLayout(board.length, 25);
        const y = playerId === 'opponent' ? OPPONENT_BOARD_Y : PLAYER_BOARD_Y;
        return { x: startX + index * spacing, y };
    }

    /** The just-played Aether card's resting slot, using the same layout math as
     * renderAetherInPlay/renderAetherMarker — or undefined if it's no longer in aetherInPlay
     * (shouldn't happen; playAetherCard always moves the card there synchronously before this
     * runs). A generic card lands on the round pool marker (aetherMarkerSlot); every other
     * category uses its own row in the elemental stack. */
    private computeAetherPileDestination (instanceId: string, playerId: PlayerId): { x: number; y: number } | undefined
    {
        const playerState = this.machine.state.players[playerId];
        const card = playerState.aetherInPlay.find((c) => c.instanceId === instanceId);
        const category = card ? CARD_DEFINITIONS[card.definitionId]?.aetherCategory : undefined;
        if (!category) return undefined;

        if (category === 'generic') return this.aetherMarkerSlot(playerId);

        return this.aetherPileSlot(playerId, this.aetherPileRow(playerState, category));
    }

    /**
     * Spotlights a just-played Aether card the same way playCardPlayedAnimation does for a normal
     * card, then flies it into its resting category pile — shrinking and fading out along the way
     * since, unlike a minion's board slot, the pile destination is a small stacked-count icon, not
     * another full-size card. Mirrors playCardPlayedAnimation's hand-container-swap step so the
     * opponent's face-down Aether card is revealed face-up before it flies.
     */
    private async playAetherCardPlayedAnimation (instanceId: string, playerId: PlayerId): Promise<void>
    {
        let container = this.instanceContainers.get(instanceId);
        if (!container) return;

        {
            const player = this.machine.state.players[playerId];
            const instance = player.aetherInPlay.find((c) => c.instanceId === instanceId);
            if (instance)
            {
                const revealed = this.cardView.createCardContainer(instance, 'full', undefined, false, false, resolveCardText(instance, this.machine.state));
                revealed.setPosition(container.x, container.y);

                const index = this.renderedObjects.indexOf(container);
                if (index !== -1) this.renderedObjects[index] = revealed;
                else this.renderedObjects.push(revealed);

                container.destroy();
                this.instanceContainers.set(instanceId, revealed);
                container = revealed;
            }
        }

        container.setDepth(2500);

        const spotlightOrigin = { x: container.x, y: container.y };
        const handle = beginFlightTilt(this, container, { scaleDriven: true });
        await this.tweenPromise({
            targets: container, x: SPOTLIGHT_X, y: CENTER_Y, scale: 1.25, duration: 350, ease: 'Cubic.easeOut',
            onUpdate: (tween) => updateFlightTilt(handle, SPOTLIGHT_X - spotlightOrigin.x, CENTER_Y - spotlightOrigin.y, Math.sin(tween.progress * Math.PI)),
        });
        await this.delay(550);

        const destination = this.computeAetherPileDestination(instanceId, playerId) ?? { x: container.x, y: container.y };
        const boardOrigin = { x: container.x, y: container.y };
        await this.tweenPromise({
            targets: container, x: destination.x, y: destination.y, scale: 0.3, alpha: 0, duration: 350, ease: 'Cubic.easeIn',
            onUpdate: (tween) => updateFlightTilt(handle, destination.x - boardOrigin.x, destination.y - boardOrigin.y, Math.sin(tween.progress * Math.PI)),
        });
        endFlightTilt(handle);
    }

    /**
     * Flies a temporary card preview from the drawing player's deck pile to the drawn card's
     * computed arced hand slot, then promotes it into instanceContainers/renderedObjects as that
     * card's resting container instead of discarding it — a full renderNow() stays deferred for
     * the *entire* burst of opening-hand draws (they all queue back-to-back into one animating
     * session, see the class doc comment), so a discarded preview left nothing on screen between
     * draws. Sibling cards already resting in this hand are re-tweened to their updated slot
     * first, since a growing hand recenters/rescales the whole row (handRowLayout's
     * spacing/startX/scale all shift with count) — without that they'd sit at a stale pre-draw
     * position until the eventual renderNow(). The newly-landed card itself is left
     * non-interactive (no peek/drag wiring) same as before — it only becomes interactive once
     * the next real renderNow() rebuilds it properly.
     */
    private async playDrawAnimation (playerId: PlayerId, instanceId: string): Promise<void>
    {
        const player = this.machine.state.players[playerId];
        const index = player.hand.findIndex((c) => c.instanceId === instanceId);
        if (index === -1) return;

        const faceDown = playerId === 'opponent';
        const liftSign: 1 | -1 = faceDown ? -1 : 1;
        const edgeY = playerId === 'opponent' ? OPPONENT_HAND_Y : PLAYER_HAND_POKE_Y;
        const layout = this.handRowLayout(player.hand.length);

        player.hand.forEach((sibling, siblingIndex) =>
        {
            if (sibling.instanceId === instanceId) return;
            const container = this.instanceContainers.get(sibling.instanceId);
            if (!container) return;
            const slot = this.handCardSlot(siblingIndex, player.hand.length, layout, edgeY, liftSign);
            this.tweens.add({ targets: container, x: slot.x, y: slot.y, rotation: slot.rotation, scale: slot.scale, duration: 250, ease: 'Cubic.easeOut' });
        });

        const destSlot = this.handCardSlot(index, player.hand.length, layout, edgeY, liftSign);
        const isAether = CARD_DEFINITIONS[player.hand[index].definitionId]?.type === 'aether';
        const origin = isAether ? this.aetherDeckPilePosition(playerId) : this.deckPilePosition(playerId);
        const flying = this.cardView.createCardContainer(player.hand[index], faceDown ? 'faceDown' : 'full', undefined, false, false, resolveCardText(player.hand[index], this.machine.state));
        flying.setPosition(origin.x, origin.y);
        flying.setDepth(3000);
        flying.setScale(0.6);

        // rotation/scale are both already tween-driven below (destSlot.rotation/scale), so the
        // handle reads their live tween-interpolated values as its base each frame instead of a
        // fixed one — see cardFlightTilt.ts's doc comment for why that's safe.
        const handle = beginFlightTilt(this, flying, { rotationDriven: true, scaleDriven: true });
        await this.tweenPromise({
            targets: flying, x: destSlot.x, y: destSlot.y, rotation: destSlot.rotation, scale: destSlot.scale, duration: 400, ease: 'Cubic.easeOut',
            onUpdate: (tween) => updateFlightTilt(handle, destSlot.x - origin.x, destSlot.y - origin.y, Math.sin(tween.progress * Math.PI)),
        });
        endFlightTilt(handle);

        flying.setDepth(destSlot.depth);
        this.renderedObjects.push(flying);
        this.instanceContainers.set(instanceId, flying);
    }

    /**
     * Pulls a hand card out to the spotlight while the player picks a target for it (see
     * TurnStateMachine's 'state:target-begin' emit and renderHand's heldCard branch, which this
     * settles into) — the mirror image of playDrawAnimation's sibling reflow above: closing the gap
     * the held card leaves rather than opening one for an incoming card. Only ever fired for the
     * human player's own hand (see targetBeginHandler).
     */
    private async playTargetBeginAnimation (instanceId: string): Promise<void>
    {
        const container = this.instanceContainers.get(instanceId);
        if (!container) return;

        const player = this.machine.state.players.player;
        const remaining = player.hand.filter((c) => c.instanceId !== instanceId);
        const layout = this.handRowLayout(remaining.length);

        remaining.forEach((sibling, siblingIndex) =>
        {
            const sibContainer = this.instanceContainers.get(sibling.instanceId);
            if (!sibContainer) return;
            const slot = this.handCardSlot(siblingIndex, remaining.length, layout, PLAYER_HAND_POKE_Y, 1);
            this.tweens.add({ targets: sibContainer, x: slot.x, y: slot.y, rotation: slot.rotation, scale: slot.scale, duration: 250, ease: 'Cubic.easeOut' });
        });

        container.setDepth(2500);
        await this.tweenPromise({ targets: container, x: SPOTLIGHT_X, y: CENTER_Y, rotation: 0, scale: 1.25, duration: 300, ease: 'Cubic.easeOut' });
    }

    /**
     * Flies a held card (see playTargetBeginAnimation above) back into the hand fan when its cast is
     * cancelled (TurnStateMachine's 'state:target-cancelled') — the card's index in player.hand never
     * changed (cancelTarget never touches the hand array), so its post-cancel slot is simply its
     * normal full-fan position. Only ever fired for the human player's own hand (see
     * targetCancelledHandler).
     */
    private async playTargetCancelledAnimation (instanceId: string): Promise<void>
    {
        const container = this.instanceContainers.get(instanceId);
        if (!container) return;

        const player = this.machine.state.players.player;
        const index = player.hand.findIndex((c) => c.instanceId === instanceId);
        if (index === -1) return;

        const layout = this.handRowLayout(player.hand.length);

        player.hand.forEach((sibling, siblingIndex) =>
        {
            if (sibling.instanceId === instanceId) return;
            const sibContainer = this.instanceContainers.get(sibling.instanceId);
            if (!sibContainer) return;
            const slot = this.handCardSlot(siblingIndex, player.hand.length, layout, PLAYER_HAND_POKE_Y, 1);
            this.tweens.add({ targets: sibContainer, x: slot.x, y: slot.y, rotation: slot.rotation, scale: slot.scale, duration: 250, ease: 'Cubic.easeOut' });
        });

        const destSlot = this.handCardSlot(index, player.hand.length, layout, PLAYER_HAND_POKE_Y, 1);
        await this.tweenPromise({ targets: container, x: destSlot.x, y: destSlot.y, rotation: destSlot.rotation, scale: destSlot.scale, duration: 300, ease: 'Cubic.easeIn' });
        container.setDepth(destSlot.depth);
    }

    /**
     * Drives one step of the opponent's turn. Executing an action always resolves the state
     * machine back to MainIdle (or GameOver); renderNow() re-schedules this method 600ms after
     * each such settle (see its tail), so a full turn is a chain of these calls, paced 600ms
     * apart and naturally waiting out any in-flight animation along the way.
     */
    private runOpponentTurn (): void
    {
        const state = this.machine.state;
        if (state.phase !== TurnPhase.MainIdle || state.activePlayer !== 'opponent') return;

        const action = decideOpponentAction(state);
        if (!action)
        {
            console.log('[CardGame] opponent passes, ending turn');
            this.machine.endTurn();
            // Covers the opponent's own Curfew (endOfTurn) phase, which endTurn() may have just
            // entered synchronously above (activePlayer is still 'opponent' at that point) — see
            // drainOpponentTargeting.
            this.drainOpponentTargeting();
            return;
        }

        console.log('[CardGame] opponent action', action);
        switch (action.kind)
        {
            case 'playCard':
                this.machine.playCard(action.instanceId);
                break;
            case 'attack':
                this.machine.declareAttack(action.attackerInstanceId);
                // Attack's own first target-selection step (who to attack) was already decided
                // during ranking (scoreAttack) — every subsequent prompt (the attacker's own
                // onAttack chosen action, if any) is resolved generically by drainOpponentTargeting
                // below.
                if (this.machine.state.phase === TurnPhase.AwaitingTarget) this.machine.selectTarget(action.targetId);
                break;
            case 'activateAbility':
                this.machine.activateAbility(action.instanceId, action.abilityIndex);
                break;
            case 'drawAether':
            case 'playAetherCard':
                // Neither method fires 'state:phase-change' (no phase transition happens) — unlike
                // every other action above, nothing will otherwise schedule this turn's next
                // 600ms tick, so requestRender() must be called explicitly here (same reasoning as
                // debugAddCard's own caller — see its wiring comment further down this file).
                // drawAether's own draw animation is already handled by cardDrawnHandler/
                // pendingDrawIds (requestRender flushes those); playAetherCard has no such event, so
                // its flight animation is enqueued directly here — see the player's own drop-handler
                // call site for why the requestRender() right after still needs to run.
                if (action.kind === 'drawAether')
                {
                    this.machine.drawAether('opponent');
                }
                else
                {
                    this.machine.playAetherCard(action.instanceId);
                    this.enqueueAnimation(() => this.playAetherCardPlayedAnimation(action.instanceId, 'opponent'));
                }
                this.requestRender();
                break;
            default:
                // Exhaustiveness check — a new AIAction kind with no case above fails to compile
                // here instead of silently falling through.
                ((_: never) => { })(action);
        }

        this.drainOpponentTargeting();
    }

    /**
     * Resolves every AwaitingTarget prompt whose true owner is the AI (state.pendingTarget.ownerId
     * === 'opponent'), one at a time, via decideOpponentTarget — covers the played card/ability/
     * attacker's own chosen-target effect(s) and any board-wide Channel/Muster/Curfew/Vigil
     * reaction the action triggered, uniformly, since TurnStateMachine collects every prompt for a
     * declared action (or turn transition) up front before resolving it — see
     * TurnStateMachine.beginTargeting/collectPendingPrompts. Also covers the opponent's own
     * startTurn/Vigil phase, which can begin synchronously inside this.machine.endTurn() when
     * called from the *player's* End Turn button (see that handler, below) — nothing else in this
     * file would otherwise ever resume that prompt.
     *
     * Gates on pendingTarget.ownerId, not state.activePlayer: a Tier-2 (onDeath/onDamaged/
     * onFriendlyMinionDeath) prompt's true owner can differ from whoever's turn it currently is —
     * e.g. the human's own attack can kill the AI's Deathcry minion mid-player-turn — so this is
     * called after every player-initiated action too (see the playCard/activateAbility/
     * selectTarget call sites below), not just after the opponent's own actions. The loop stops
     * correctly at a human-owned prompt (ownerId === 'player') even when raised reactively during
     * the opponent's own turn, leaving it for the Scene to render normally instead of auto-resolving
     * the human's own choice.
     */
    private drainOpponentTargeting (): void
    {
        while (this.machine.state.phase === TurnPhase.AwaitingTarget && this.machine.state.pendingTarget?.ownerId === 'opponent')
        {
            const targetId = decideOpponentTarget(this.machine.state);
            // Shouldn't happen (every scoreXSpell helper has an own-board fallback), but avoids a
            // hang rather than relying on that.
            if (targetId === undefined) break;
            this.machine.selectTarget(targetId);
        }
    }

    constructor ()
    {
        super('CardGame');
    }

    create ()
    {
        // scene.restart() (the Play Again button) reuses this same class instance, so field
        // initializers do NOT re-run — construct fresh cardView/helpBoxController/pileView so
        // their internal state (including which pile-view overlay was open) doesn't leak from a
        // finished game into the next one.
        this.cardView = new CardView(this);
        this.helpBoxController = new HelpBoxController(this, () => this.draggedContainer);
        this.pileView = new PileViewController(this, this.cardView, this.helpBoxController);
        // Playtesting-only cheat wiring (debugAddCard) — see SPEC.md's "Playtesting-only features"
        // section for why this exists and where it needs to be ripped out. Unlike every other
        // TurnStateMachine call the player can trigger, debugAddCard fires no 'state:phase-change'
        // (it isn't part of the normal turn flow), so nothing would otherwise schedule the
        // renderNow() that re-lays the hand fan and rewires the new card's interactivity —
        // requestRender() here both enqueues the draw animation itself (see its pendingDrawIds
        // check, fed synchronously by debugAddCard's 'state:card-drawn' emit) and queues that
        // rebuild for once it drains, exactly like a real draw gets via its own eventual phase change.
        this.cardPicker = new CardPickerController(this, this.cardView, this.helpBoxController,
            (definitionId) =>
            {
                this.machine.debugAddCard('player', definitionId);
                this.requestRender();
            });

        this.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x161b26);

        // Sits in the gap between the opponent's and player's Aether columns (both anchored at
        // AETHER_ROW_X_START), vertically centered on the screen — eye-tuned and confirmed in the
        // browser like the rest of that column's own layout constants.
        this.turnBannerText = this.add.text(AETHER_ROW_X_START, CENTER_Y, '', SMALL_STYLE).setOrigin(0, 0.5).setDepth(200);

        const boardZoneH = CARD_H + 30;
        this.add.rectangle(CENTER_X, PLAYER_BOARD_Y, BOARD_ZONE_W, boardZoneH).setStrokeStyle(2, 0x3a4a6b, 0.6);

        // The only registered drag drop zone now — releasing a dragged hand card over it cancels
        // the cast; releasing anywhere else on screen attempts one (see wireDragEvents' dragend
        // handler, which reads Phaser's own `dropped` flag rather than checking a board zone).
        this.add
            .zone(CENTER_X, GAME_HEIGHT, HAND_DROP_ZONE_W, HAND_DROP_ZONE_H * 2)
            .setRectangleDropZone(HAND_DROP_ZONE_W, HAND_DROP_ZONE_H * 2);

        this.createEndTurnButton();
        this.createCancelButton();
        this.createDrawCardButton();
        this.createFullManaButton();
        this.createTargetPromptBox();
        this.wireDragEvents();
        this.input.keyboard?.on('keydown-ESC', () => { this.pileView.close(); this.cardPicker.close(); });

        // Drives hand-card peek hover for every currently-rendered card in one place, using a
        // manual rectangle check against handPeekZones (populated by renderHand) rather than
        // Phaser's per-object pointerover/pointerout. Those per-object events are filtered by
        // Phaser's default topOnly input priority — with a card's own hit area stacked on top of
        // its hover-padding zone, only one of the two ever receives events for a given pointer
        // position, which previously left the padding-only area silently unresponsive (and, in an
        // earlier attempt, left pointerout undelivered once the pointer left through it, sticking
        // the card mid-peek forever). A scene-level 'pointermove' event is dispatched unconditionally
        // on every pointer move, independent of any game object's hit test, so it can't be starved
        // by topOnly — this is the single source of truth for peek state.
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) =>
        {
            for (const [container, zone] of this.handPeekZones)
            {
                if (container === this.draggedContainer || this.isAnimating) continue;
                const inside = pointer.worldX >= zone.left && pointer.worldX <= zone.right && pointer.worldY >= zone.top && pointer.worldY <= zone.bottom;
                if (inside === zone.peeked) continue;
                zone.peeked = inside;
                if (inside) zone.peekIn(); else zone.peekOut();
            }
        });

        EventBus.on('state:phase-change', this.phaseChangeHandler);
        EventBus.on('state:card-drawn', this.cardDrawnHandler);
        EventBus.on('state:card-played', this.cardPlayedHandler);
        EventBus.on('state:attack', this.attackHandler);
        EventBus.on('state:card-died', this.cardDiedHandler);
        EventBus.on('state:target-begin', this.targetBeginHandler);
        EventBus.on('state:target-cancelled', this.targetCancelledHandler);
        EventBus.on('state:damaged', this.damagedHandler);
        EventBus.on('state:healed', this.healedHandler);
        this.events.once('shutdown', () =>
        {
            EventBus.removeListener('state:phase-change', this.phaseChangeHandler);
            EventBus.removeListener('state:card-drawn', this.cardDrawnHandler);
            EventBus.removeListener('state:card-played', this.cardPlayedHandler);
            EventBus.removeListener('state:attack', this.attackHandler);
            EventBus.removeListener('state:target-begin', this.targetBeginHandler);
            EventBus.removeListener('state:target-cancelled', this.targetCancelledHandler);
            EventBus.removeListener('state:card-died', this.cardDiedHandler);
            EventBus.removeListener('state:damaged', this.damagedHandler);
            EventBus.removeListener('state:healed', this.healedHandler);
        });

        // Player's deck comes from DeckSelectScreen (via matchSetup.ts's singleton) and the
        // opponent's is a random pick from the same legal saved-deck pool — see deckStorage.ts.
        // generateDeck()/generateAetherDeck() only remain as a defensive fallback for an
        // unreachable-in-normal-play case (a future direct-scene launch bypassing the React
        // gate, or an empty/corrupt deck store), not the live match-start path.
        const playerDeck = getPlayerDeckForMatch();
        const legalDecks = loadDecks().filter(isDeckLegal);
        const opponentDeck = legalDecks.length > 0 ? pickRandomLegalDeck(legalDecks) : undefined;

        this.machine = new TurnStateMachine(createInitialState(
            playerDeck?.mainDeckIds ?? generateDeck(),
            playerDeck?.aetherDeckIds ?? generateAetherDeck(),
            opponentDeck?.mainDeckIds ?? generateDeck(),
            opponentDeck?.aetherDeckIds ?? generateAetherDeck(),
        ));

        // Paint the empty board (deck piles included) before startGame() fires its opening-hand
        // draws, so the draw animation has a visible deck pile to fly from. Everything from here
        // on is driven by 'state:phase-change' via phaseChangeHandler/requestRender.
        this.renderNow();
        this.machine.startGame();

        EventBus.emit('current-scene-ready', this);
    }

    // --- one-time setup --------------------------------------------------------

    private wireDragEvents (): void
    {
        this.input.on('dragstart', (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) =>
        {
            const container = gameObject as Phaser.GameObjects.Container;
            // Kill any in-flight peek tween so it can't fight this handler's own per-pointermove
            // setPosition() below, and snap upright — a rotated card being dragged around the
            // battlefield would look broken, and "animate upright" is peek's own language for a
            // picked-up card anyway.
            this.tweens.killTweensOf(container);
            container.setRotation(0);
            container.setDepth(1000);
            this.draggedContainer = container;

            // Nothing else touches rotation/scale while the pointer is dragging it (position is
            // set directly below, not via tween), so the handle owns both against their fixed
            // (just-reset) base until dragend switches it into a tween-driven snap-back, if any.
            this.flightTiltHandles.set(container, beginFlightTilt(this, container));

            // The keyword tooltip that was showing for this card (hovering it is how the drag
            // started) would otherwise linger for the whole drag — pointerout never fires for the
            // dragged object since it stays centered under the pointer throughout.
            this.helpBoxController.hideHelpBox();
        });

        this.input.on('drag', (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject, dragX: number, dragY: number) =>
        {
            const container = gameObject as Phaser.GameObjects.Container;
            container.setPosition(dragX, dragY);
            const handle = this.flightTiltHandles.get(container);
            if (handle) updateFlightTiltFromPointer(handle, dragX, dragY);
        });

        this.input.on('dragend', (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject, dropped: boolean) =>
        {
            const container = gameObject as Phaser.GameObjects.Container;
            if (this.draggedContainer === container) this.draggedContainer = null;

            const handle = this.flightTiltHandles.get(container);
            const endHandle = (): void =>
            {
                if (!handle) return;
                endFlightTilt(handle);
                this.flightTiltHandles.delete(container);
            };

            if (!container.active) { endHandle(); return; } // already destroyed by a re-render triggered from playCard below
            if (this.isAnimating) { endHandle(); return; }

            if (!dropped)
            {
                // Released anywhere but the hand (handZone is the only registered drop zone, so
                // Phaser's own `dropped` flag already tells us whether the hand was hit) — attempt
                // the cast. If this needs a target, playCard synchronously drives the state machine
                // into AwaitingTarget, which re-renders (destroying `container`) before this call
                // returns — nothing below touches it again, so that's safe.
                endHandle();
                const instanceId = this.cardInstanceByContainer.get(container);
                if (instanceId)
                {
                    const definition = CARD_DEFINITIONS[this.machine.state.players.player.hand.find((c) => c.instanceId === instanceId)?.definitionId ?? ''];
                    if (definition?.type === 'aether')
                    {
                        // No targeting/generator machinery (see TurnStateMachine.playAetherCard's
                        // doc comment) and no 'state:phase-change' fires — this scene must trigger
                        // its own animation+re-render, same as cardPlayedHandler does off
                        // 'state:card-played' for a normal card. enqueueAnimation flips isAnimating
                        // on synchronously, so the requestRender() right after it defers instead of
                        // snapping straight to the final render.
                        this.machine.playAetherCard(instanceId);
                        this.enqueueAnimation(() => this.playAetherCardPlayedAnimation(instanceId, 'player'));
                        this.requestRender();
                    }
                    else
                    {
                        // A card with no Tier-1 target to pick resolves fully synchronously here and
                        // can itself cascade into an opponent-owned Tier-2 prompt (e.g. its onPlay
                        // damage kills the AI's own Deathcry minion) — drain it reactively. A no-op
                        // when playCard instead entered AwaitingTarget for its own Tier-1 target,
                        // since that prompt is always player-owned. See drainOpponentTargeting's doc
                        // comment.
                        this.machine.playCard(instanceId);
                        this.drainOpponentTargeting();
                    }
                }
                return;
            }

            // Released back over the hand: cancel — fly back to its idle slot rather than snapping.
            const slot = this.handSlots.get(container);
            if (slot)
            {
                // The snap-back tween now drives rotation itself, so hand tilt ownership of that
                // property over to it (see cardFlightTilt.ts's rotationDriven doc comment) — tilt
                // simply decays to flat (target intensity 0) over the tween's real-time duration.
                if (handle) handle.rotationDriven = true;
                this.tweens.add({
                    targets: container, x: slot.x, y: slot.y, rotation: slot.rotation, duration: 200, ease: 'Cubic.easeOut',
                    onUpdate: () => { if (handle) updateFlightTilt(handle, 0, 0, 0); },
                    onComplete: endHandle,
                });
                container.setDepth(slot.depth);
            }
            else
            {
                endHandle();
            }
        });
    }

    private createEndTurnButton (): void
    {
        const container = this.add.container(1820, CENTER_Y);
        const bg = this.add.rectangle(0, 0, 160, 65, 0x3a4a6b).setStrokeStyle(2, 0x8fa8d6);
        const text = this.add.text(0, 0, 'End Turn', SMALL_STYLE).setOrigin(0.5);
        container.add([bg, text]);
        container.setSize(160, 65);
        container.setInteractive({ useHandCursor: true });
        container.on('pointerup', this.guarded(() => { this.machine.endTurn(); this.drainOpponentTargeting(); }));
        this.endTurnButton = container;
    }

    private createCancelButton (): void
    {
        const container = this.add.container(1820, CENTER_Y);
        const bg = this.add.rectangle(0, 0, 160, 65, 0x6b3a3a).setStrokeStyle(2, 0xd68f8f);
        const text = this.add.text(0, 0, 'Cancel', SMALL_STYLE).setOrigin(0.5);
        container.add([bg, text]);
        container.setSize(160, 65);
        container.setInteractive({ useHandCursor: true });
        container.on('pointerup', this.guarded(() => this.machine.cancelTarget()));
        container.setVisible(false);
        this.cancelButton = container;
    }

    /** Named targeting prompt's box — same visual treatment as HelpBoxController's tooltip
     * background (black @ 90% opacity, TOOLTIP_BG_RADIUS rounded corners, no border/stroke), just
     * on its own Container/Graphics rather than sharing HelpBoxController's instance, since this
     * one is chrome (updated in updateChrome, alongside turnBannerText) rather than hover-driven.
     * Sized and positioned per-update in updateTargetPromptBox, since both depend on the prompt's
     * text content and whether a card is currently spotlighted. */
    private createTargetPromptBox (): void
    {
        const bg = this.add.graphics();
        const text = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff' }).setOrigin(0.5);
        const container = this.add.container(0, 0, [bg, text]);
        container.setDepth(2600); // above the spotlighted card's depth (2500) while one's held
        container.setVisible(false);
        this.targetPromptBg = bg;
        this.targetPromptText = text;
        this.targetPromptBox = container;
    }

    /**
     * Playtesting-only cheat control — see SPEC.md's "Playtesting-only features" section. Stacked
     * in the End Turn/Cancel button's own column (x=1744), below Cancel, so all four buttons read
     * as one control cluster — the bottom-left corner they used to occupy is now the Aether Deck
     * pile's spot instead (see renderPile's aetherDeck calls in renderNow). Distinct purple palette
     * (vs. End Turn's blue / Cancel's red) so it still reads as a debug control, not a real
     * gameplay button. Always interactive — mirrors debugAddCard's own "no phase/turn gating,
     * callable any time" — just guarded() like every other button here so a click mid-animation is
     * ignored rather than firing on stale state.
     */
    private createDrawCardButton (): void
    {
        const container = this.add.container(1820, CENTER_Y - 100);
        const bg = this.add.rectangle(0, 0, 160, 30, 0x4a2f5c).setStrokeStyle(2, 0xb08fd6);
        const text = this.add.text(0, 0, 'Cards', SMALL_STYLE).setOrigin(0.5);
        container.add([bg, text]);
        container.setSize(160, 30);
        container.setInteractive({ useHandCursor: true });
        container.on('pointerup', this.guarded(() => this.cardPicker.open(this.machine.state)));
        this.drawCardButton = container;
    }

    /**
     * Playtesting-only cheat control — see SPEC.md's "Playtesting-only features" section. Sits
     * immediately below Draw Card in the same column, same size/purple palette, reading as a
     * matching pair of debug tools. Fills aetherInPlay directly (see
     * TurnStateMachine.debugFillAether) rather than a mana value now that mana no longer exists.
     * No animation/render-queue involvement (unlike debugAddCard) since there's nothing to fly
     * across the screen — requestRender() just refreshes the board/HUD directly (updateChrome/
     * renderNow run synchronously since nothing is animating at the time this fires).
     */
    private createFullManaButton (): void
    {
        const container = this.add.container(1820, CENTER_Y - 60);
        const bg = this.add.rectangle(0, 0, 160, 30, 0x4a2f5c).setStrokeStyle(2, 0xb08fd6);
        const text = this.add.text(0, 0, 'Add Aether', SMALL_STYLE).setOrigin(0.5);
        container.add([bg, text]);
        container.setSize(160, 30);
        container.setInteractive({ useHandCursor: true });
        container.on('pointerup', this.guarded(() => { this.machine.debugFillAether('player'); this.requestRender(); }));
        this.fullManaButton = container;
    }

    // --- render ------------------------------------------------------------------

    /** Banner text and End Turn/Cancel/target-prompt state — cheap, and safe to refresh immediately
     * even while the heavy board rebuild below is deferred behind an in-flight animation. Aether
     * counts no longer get their own HUD text — they're read off the pile stacks themselves (see
     * renderAetherInPlay). */
    private updateChrome (state: GameState): void
    {
        this.turnBannerText.setText(this.describePhase(state));

        this.updateEndTurnButton(state);
        this.updateCancelButton(state);
        this.updateTargetPromptBox(state);
    }

    /** Named targeting prompt (e.g. "Choose a target for Silence") — see targetPromptBox's own
     * doc comment. Always horizontally anchored at SPOTLIGHT_X (the same x a spotlighted card
     * sits at) so the prompt reads consistently as "the left-side targeting slot" regardless of
     * trigger source. Vertically: below the spotlighted card when the current prompt's source is
     * one (a card held from the player's own hand — the only case that gets the spotlight
     * treatment at all; an attacker, an activating board minion, or a board-wide
     * Channel/Muster/Vigil/Curfew reaction's source never leaves the board — see
     * TurnStateMachine.beginTargeting's 'state:target-begin' emit, playCard-only), otherwise
     * screen-vertically-centered. Never shown for the opponent's own targeting (pendingTarget.
     * ownerId === 'opponent') — that always resolves reactively via drainOpponentTargeting before
     * the Scene ever renders an AwaitingTarget frame for it, regardless of whose turn it currently
     * is (see drainOpponentTargeting's doc comment for why ownerId, not activePlayer, is the right
     * gate here). */
    private updateTargetPromptBox (state: GameState): void
    {
        const pendingTarget = state.pendingTarget;
        if (state.phase !== TurnPhase.AwaitingTarget || pendingTarget?.ownerId !== 'player')
        {
            this.targetPromptBox.setVisible(false);
            return;
        }

        this.targetPromptText.setText(this.describeTargetPrompt(pendingTarget));

        const padX = 22;
        const padY = 14;
        const w = this.targetPromptText.width + padX * 2;
        const h = this.targetPromptText.height + padY * 2;
        this.targetPromptBg.clear();
        this.targetPromptBg.fillStyle(0x000000, 0.9);
        this.targetPromptBg.fillRoundedRect(-w / 2, -h / 2, w, h, TOOLTIP_BG_RADIUS);

        const spotlighted = state.players.player.hand.some((c) => c.instanceId === pendingTarget.sourceInstanceId);
        const gapBelowSpotlight = 36;
        this.targetPromptBox.setPosition(
            SPOTLIGHT_X,
            spotlighted ? CENTER_Y + (CARD_H * 1.25) / 2 + gapBelowSpotlight : CENTER_Y
        );
        this.targetPromptBox.setVisible(true);
    }

    private describeTargetPrompt (pendingTarget: PendingTarget): string
    {
        // pendingTarget.action is absent only for attack's own first step (who to attack) — every
        // other prompt is a real EffectAction (see PendingTarget's doc comment, GameState.ts).
        const base = pendingTarget.action ? `Choose a target for ${this.describeEffectAction(pendingTarget.action)}` : 'Choose an attack target';
        return pendingTarget.totalSteps > 1 ? `${base} (${pendingTarget.step} of ${pendingTarget.totalSteps})` : base;
    }

    /** Short display label for an EffectAction's kind — grantKeyword reuses KEYWORD_METADATA's own
     * label (e.g. "Divine Shield") rather than a generic "Grant Keyword", so the prompt reads the
     * same way the card's own rule text/keyword badge would. draw/summon never actually reach
     * AwaitingTarget (neither kind has a `target`, so collectPendingPrompts never produces a
     * prompt for one) — covered here only for switch exhaustiveness. */
    private describeEffectAction (action: EffectAction): string
    {
        switch (action.kind)
        {
            case 'damage': return 'Damage';
            case 'heal': return 'Heal';
            case 'buff': return 'Buff';
            case 'freeze': return 'Freeze';
            case 'silence': return 'Silence';
            case 'destroy': return 'Destroy';
            case 'grantKeyword': return KEYWORD_METADATA[action.keyword].label;
            case 'draw':
            case 'summon':
                return 'Effect';
        }
    }

    private renderNow (): void
    {
        this.clearRendered();
        const state = this.machine.state;

        this.updateChrome(state);

        this.renderHero('opponent', OPPONENT_HERO_Y);
        this.renderHero('player', PLAYER_HERO_Y);

        this.renderPile(state.players.opponent, 'graveyard', OPPONENT_GRAVEYARD_Y);
        this.renderPile(state.players.opponent, 'deck', OPPONENT_DECK_Y);
        this.renderPile(state.players.player, 'deck', PLAYER_DECK_Y);
        this.renderPile(state.players.player, 'graveyard', PLAYER_GRAVEYARD_Y);

        // Aether Deck pile — bottom-left of the board (mirrors the Main Deck/Graveyard column onto
        // the opposite screen edge, see AETHER_PILE_X's own doc comment). Click-to-draw replaces
        // the default inspect-open, but only when it's actually legal right now (mirrors
        // TurnStateMachine.drawAether's own guard — this scene must independently re-check it too,
        // per CLAUDE.md's silent-rejection rule) — otherwise it falls back to inspecting the pile,
        // same as every other pile.
        for (const playerState of [state.players.opponent, state.players.player])
        {
            const y = playerState.id === 'opponent' ? OPPONENT_AETHER_DECK_Y : PLAYER_AETHER_DECK_Y;
            const canDraw = state.phase === TurnPhase.MainIdle && state.activePlayer === playerState.id
                && !playerState.aetherDrawnThisTurn && playerState.aetherDeck.length > 0;
            const onClick = canDraw
                ? () => { this.machine.drawAether(playerState.id); this.requestRender(); }
                : undefined;
            this.renderPile(playerState, 'aetherDeck', y, AETHER_PILE_X, onClick, canDraw);
        }

        this.renderHand(state.players.opponent, OPPONENT_HAND_Y, true);
        this.renderHand(state.players.player, PLAYER_HAND_POKE_Y, false);

        this.renderBoard('opponent', state.players.opponent, OPPONENT_BOARD_Y);
        this.renderBoard('player', state.players.player, PLAYER_BOARD_Y);

        this.renderAetherInPlay(state.players.opponent);
        this.renderAetherInPlay(state.players.player);
        this.renderAetherMarker(state.players.opponent);
        this.renderAetherMarker(state.players.player);

        if (state.phase === TurnPhase.GameOver)
        {
            this.showGameOver(state.winner);
        }

        // Repaint last so the overlay lands on top of, and re-reads, the board just rebuilt above —
        // an open pile therefore keeps showing live contents as cards are drawn or die beneath it.
        // cardPicker's content never depends on state, but it still needs the same treatment to
        // survive teardown (e.g. across the opponent's 600ms-paced rebuilds) the same way pileView does.
        this.pileView.render(state);
        this.cardPicker.render(state);

        // The opponent's turn is only picked up here — the one place the board is guaranteed to
        // actually reflect state.phase === MainIdle — rather than off the phase-change event
        // itself, since that event can fire well before any in-flight animation has drained.
        if (state.phase === TurnPhase.MainIdle && state.activePlayer === 'opponent')
        {
            this.time.delayedCall(600, () => this.runOpponentTurn());
        }
    }

    private clearRendered (): void
    {
        this.helpBoxController.hideHelpBox();
        this.pileView.clear();
        this.cardPicker.clear();
        for (const obj of this.renderedObjects) obj.destroy();
        this.renderedObjects = [];
        this.cardInstanceByContainer.clear();
        this.handSlots.clear();
        this.handPeekZones.clear();
        this.instanceContainers.clear();
        this.heroContainers.clear();
    }

    private describePhase (state: GameState): string
    {
        if (state.phase === TurnPhase.GameOver)
        {
            return state.winner === 'player' ? 'You win!' : 'You lose!';
        }
        // AwaitingTarget no longer gets its own banner text here — targetPromptBox (see
        // updateTargetPromptBox) now owns that messaging with a named, better-placed prompt, so
        // this just keeps reading as an ordinary turn indicator underneath it.
        const whoseTurn = state.activePlayer === 'player' ? 'Your' : "Opponent's";
        return `${whoseTurn} turn (Turn ${state.turnNumber})`;
    }

    /** Shared spacing/start-x math for a horizontal row of `count` cards centered on CENTER_X, used by both the hand and board rows (and by the played-card/draw animations to predict a card's resting slot ahead of the next real render). */
    private rowLayout (count: number, maxGap: number): { spacing: number; startX: number }
    {
        const spacing = Math.min(CARD_W + maxGap, BOARD_ZONE_W / count);
        const startX = CENTER_X - ((count - 1) * spacing) / 2;
        return { spacing, startX };
    }

    /**
     * Hand-specific row layout — kept separate from `rowLayout` (which still serves the board's
     * cost-badge-less 'simplified' cards untouched) because a hand needs an anti-crowding floor:
     * once even-spread spacing would drop below HAND_MIN_SPACING, further shrinking it starts
     * covering a card's cost badge (see that constant's doc comment in cardLayout.ts) — no
     * z-order fix avoids that, so instead the whole row scales down uniformly around CENTER_X,
     * preserving the spacing:CARD_W ratio (and therefore corner clearance) at any hand size.
     */
    private handRowLayout (count: number): { spacing: number; startX: number; scale: number }
    {
        const footprint = (count - 1) * HAND_MIN_SPACING + CARD_W;
        const scale = Math.min(1, BOARD_ZONE_W / footprint);
        return { spacing: HAND_MIN_SPACING * scale, startX: CENTER_X - ((count - 1) * HAND_MIN_SPACING * scale) / 2, scale };
    }

    /**
     * A hand card's own applied rotation at index `index` of `count` — the fan's only shape
     * input (see cardLayout.ts's HAND_ARC_* block). `liftSign` flips its sign for the opponent,
     * matching handCardSlot's edge-chain direction (see there).
     */
    private handCardRotation (index: number, count: number, liftSign: 1 | -1): number
    {
        const mid = (count - 1) / 2;
        const rawDeg = (index - mid) * HAND_ARC_ANGLE_STEP_DEG;
        const deg = Math.max(-HAND_ARC_MAX_ANGLE_DEG, Math.min(HAND_ARC_MAX_ANGLE_DEG, rawDeg));
        const theta = (deg * Math.PI) / 180;
        return liftSign === 1 ? theta : -theta;
    }

    /**
     * A hand card's idle "slot" — its arced position/rotation for index `index` of `count`,
     * given `layout` (from handRowLayout) and the row's flush poke edge Y. `liftSign` is `+1`
     * for the player (bottom edge, lift rises off it) and `-1` for the opponent (top edge, lift
     * drops past it). Shared by renderHand (idle layout), playDrawAnimation (sibling re-tween /
     * fly-in destination), and indirectly by peek/dragend restore via the handSlots map
     * renderHand populates from this.
     *
     * Positions cards as a "hinge chain": each card's own visible edge (top edge for the player,
     * bottom edge for the opponent — whichever one is actually poking into view) is CARD_W long
     * and runs in the direction its own rotation points it, and each card's edge starts exactly
     * where the previous card's edge ends — like a real fanned hand of cards, so neighboring
     * cards' corners always meet with no seam, at any hand size or rotation. `x` still comes from
     * the flat per-index spacing (handRowLayout) — only `y` needs the chain, since the seam this
     * fixes is purely vertical (a card's rotation swings its own corners up/down relative to a
     * flat-spaced neighbor, not sideways by any visible amount).
     *
     * `edgeChainOffset(i)` is the unanchored, cumulative Y position of the chain's `i`-th joint
     * (the point shared by card `i-1`'s trailing corner and card `i`'s leading corner), built by
     * summing each card's own edge-segment Y-delta (`CARD_W * sin(rotation)`) in turn — computed
     * fresh per call since a hand is always small enough that this is cheap, and it keeps every
     * call site above (all of which already call this once per card, per index) unchanged.
     * `K` is the joint that sits at the fan's own center — the hinge between the two center cards
     * for an even hand, or the exact center card's own (upright, zero-rotation) edge for an odd
     * one — which is what HAND_ARC_LIFT's amplitude anchors to, matching the old code's "how high
     * the hand's center reaches" meaning even though the shape underneath it is now derived
     * differently.
     */
    private handCardSlot (index: number, count: number, layout: { spacing: number; startX: number; scale: number }, edgeY: number, liftSign: 1 | -1): HandSlot
    {
        const x = layout.startX + index * layout.spacing;
        const cardW = CARD_W * layout.scale;
        const cardH = CARD_H * layout.scale;

        const edgeChainOffset = (i: number): number =>
        {
            let offset = 0;
            for (let k = 0; k < i; k++) offset += cardW * Math.sin(this.handCardRotation(k, count, liftSign));
            return offset;
        };

        const rotation = this.handCardRotation(index, count, liftSign);
        const anchorTarget = edgeY - liftSign * HAND_ARC_LIFT * layout.scale;
        const shift = anchorTarget - edgeChainOffset(Math.floor(count / 2));

        const y = edgeChainOffset(index) + shift + (cardW / 2) * Math.sin(rotation) + liftSign * (cardH / 2) * Math.cos(rotation);
        return { x, y, rotation, scale: layout.scale, depth: index };
    }

    private renderHero (id: PlayerId, y: number): void
    {
        const state = this.machine.state;
        const container = this.add.container(CENTER_X, y);
        container.setDepth(HERO_DEPTH);

        // Active player's turn is shown by the circle's own fill shimmering yellow instead of its
        // usual flat color, rather than a border glow — a stroke-only circle layered on top keeps
        // the same white ring the flat-fill case also has.
        const isActivePlayer = state.activePlayer === id;
        if (isActivePlayer)
        {
            this.addShimmeringFill(container, HERO_RADIUS, OUTLINE_COLOR_TARGETABLE);
            container.add(this.add.circle(0, 0, HERO_RADIUS, 0x000000, 0).setStrokeStyle(2, 0xffffff));
        }
        else
        {
            container.add(this.add.circle(0, 0, HERO_RADIUS, id === 'player' ? 0x2f6fed : 0xb0413e).setStrokeStyle(2, 0xffffff));
        }
        const healthLabel = this.add.text(0, 0, `${state.players[id].health}`, HERO_HP_STYLE).setOrigin(0.5);
        container.add(healthLabel);
        container.setSize(HERO_SIZE, HERO_SIZE);
        // Container hit-testing shifts the local point by +displayOriginX/Y (= width/2, height/2 for a
        // Container) before testing it against the hit area, so a hit area centered on the visuals at
        // local (0,0) must itself be defined centered on (width/2, height/2), not on (0,0).
        container.setInteractive(new Geom.Circle(HERO_RADIUS, HERO_RADIUS, HERO_RADIUS), Geom.Circle.Contains);

        this.heroContainers.set(id, container);

        // Gate on pendingTarget.ownerId, not state.activePlayer — a Tier-2 (onDeath/onDamaged/
        // onFriendlyMinionDeath) prompt's true owner can differ from whoever's turn it currently is
        // (see PendingTarget's doc comment, GameState.ts). Gating on the actual owner here stops
        // the human from resolving the opponent's pending target (or vice versa) by clicking through
        // it, which is otherwise indistinguishable from a legitimate target prompt for either side.
        const isValidTarget =
            state.phase === TurnPhase.AwaitingTarget &&
            state.pendingTarget?.ownerId === 'player' &&
            state.pendingTarget?.validTargetIds.includes(id);
        if (isValidTarget)
        {
            this.addShimmeringOutline(container, HERO_SIZE, HERO_SIZE, OUTLINE_COLOR_TARGETABLE);
            // Resolving this prompt can itself cascade into a new Tier-2 prompt owned by the
            // opponent (e.g. this chosen action kills the AI's own Deathcry minion) — drain it
            // reactively rather than leaving the state machine stuck in AwaitingTarget with no one
            // ever calling selectTarget for it. See drainOpponentTargeting's doc comment.
            container.on('pointerup', this.guarded(() => { this.machine.selectTarget(id); this.drainOpponentTargeting(); }));
        }

        this.renderedObjects.push(container);
    }

    /**
     * Small stacked pile with a card-count readout centered over it, for any off-board zone.
     * Doubles as the origin point draw animations fly from (see deckPilePosition) and, by
     * default, as the click target that opens the pile-inspect overlay — `onClick`, when passed
     * (the Aether Deck pile's own click-to-draw affordance, see renderNow), replaces that default
     * entirely rather than running alongside it, since drawing and inspecting are mutually
     * exclusive per click. `x` defaults to the Main Deck/Graveyard column (PILE_X); the Aether
     * Deck pile passes AETHER_PILE_X instead — see its own doc comment in cardLayout.ts.
     * `readyGlow` adds the same "can act now" shimmer renderHand uses for playable cards — the
     * Aether Deck pile sets it when a draw is actually legal right now, mirroring that same
     * silent-rejection-avoidance rule (CLAUDE.md) for its own click-to-draw affordance.
     */
    private renderPile (playerState: PlayerState, zone: PileZone, y: number, x: number = PILE_X, onClick?: () => void, readyGlow = false): void
    {
        const style = PILE_STYLES[zone];
        const cards = getPileCards(playerState, zone);
        const container = this.add.container(x, y);

        // An empty pile still draws one faded card outline rather than nothing, so the zone keeps
        // its slot in the column and stays clickable (an empty graveyard is the normal opening state).
        // Deck and Aether Deck are genuinely face-down piles and use a shared card-back texture
        // for every layer. The graveyard is face-up, so instead each layer shows the actual art
        // of the card sitting at that position — most recently discarded on top — falling back to
        // the plain colored-rectangle stack per layer when that card has no art loaded yet.
        const backKey = zone === 'deck' ? CARD_BACK_KEY : zone === 'aetherDeck' ? CARD_BACK_AETHER_KEY : undefined;
        const layers = Math.min(3, Math.max(1, cards.length));
        // Oldest-of-the-visible-layers first, most recently added last — index i below lines up
        // with layer i, so the most-offset (topmost) layer is the most recently added card.
        const recentCards = cards.slice(-layers);
        for (let i = 0; i < layers; i++)
        {
            const offset = i * 4;
            const textureKey = backKey ?? (zone === 'graveyard' ? recentCards[i]?.definitionId : undefined);
            let card: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
            if (textureKey !== undefined && this.textures.exists(textureKey))
            {
                card = this.add.image(-offset, -offset, textureKey);
                coverFit(card, DECK_PILE_W, DECK_PILE_H);
            }
            else
            {
                card = this.add.rectangle(-offset, -offset, DECK_PILE_W, DECK_PILE_H, style.fill).setStrokeStyle(2, style.stroke);
            }
            if (cards.length === 0) card.setAlpha(0.3);
            container.add(card);
        }

        // Centered on the *top* (last-drawn, most-offset) layer, not the container's local origin
        // — the origin sits on layer 0's center, but each successive layer is nudged up-left by
        // `offset`, so anchoring at (0,0) drifts the count away from the visible top card as the
        // pile grows past 1 card.
        const topOffset = (layers - 1) * 4;
        container.add(this.add.text(-topOffset, -topOffset, `${cards.length}`, statStyle('#ffffff', true, '22px')).setOrigin(0.5));

        // Hit region is deliberately generous enough to cover the stack's offset corner. Top-left-
        // based per the Container hit-area rule (see renderHero).
        const hitW = DECK_PILE_W + 16;
        const hitH = DECK_PILE_H + 16;
        container.setSize(hitW, hitH);
        container.setInteractive({
            hitArea: new Geom.Rectangle(0, 0, hitW, hitH),
            hitAreaCallback: Geom.Rectangle.Contains,
            useHandCursor: true,
        });
        if (readyGlow) this.addShimmeringOutline(container, hitW, hitH, OUTLINE_COLOR_READY);
        let hoverShimmer: { destroy: () => void } | null = null;
        container.on('pointerover', () =>
        {
            hoverShimmer = this.addShimmeringOutline(container, DECK_PILE_W + 16, DECK_PILE_H + 16, OUTLINE_COLOR_HOVER);
        });
        container.on('pointerout', () =>
        {
            hoverShimmer?.destroy();
            hoverShimmer = null;
        });
        if (onClick)
        {
            // Unlike the default inspect-open below, onClick (the Aether Deck's click-to-draw) does
            // mutate game state — guarded() like every other state-mutating button, so a click mid-
            // animation is ignored rather than firing on stale state.
            container.on('pointerup', this.guarded(onClick));
        }
        else
        {
            // Deliberately not guarded(): opening a read-only pile view mutates no game state, so
            // there is no reason to swallow the click just because an animation is in flight.
            container.on('pointerup', () => this.pileView.open(playerState.id, zone, this.machine.state));
        }

        this.renderedObjects.push(container);
    }

    private renderHand (playerState: PlayerState, y: number, faceDown: boolean): void
    {
        const cards = playerState.hand;
        if (cards.length === 0) return;

        const state = this.machine.state;
        const isMyTurn = !faceDown && playerState.id === 'player' && state.activePlayer === 'player';

        // A card the player pulled out of hand and is holding at the spotlight while picking a
        // target (see TurnStateMachine's 'state:target-begin'/'state:target-cancelled' emits and
        // playTargetBeginAnimation/playTargetCancelledAnimation below) — rendered separately further
        // down instead of taking a normal fan slot, only for the human's own hand. The opponent AI
        // can pass through AwaitingTarget too, but it resolves synchronously in the same call and
        // its hand is always face-down, so it never needs this staged visual.
        const heldInstanceId =
            !faceDown && playerState.id === 'player' && state.phase === TurnPhase.AwaitingTarget
                ? state.pendingTarget?.sourceInstanceId
                : undefined;
        const heldCard = heldInstanceId ? cards.find((c) => c.instanceId === heldInstanceId) : undefined;
        const fanCards = heldCard ? cards.filter((c) => c.instanceId !== heldInstanceId) : cards;

        const layout = this.handRowLayout(fanCards.length);
        // +1 (player, bottom edge): lift rises off the poke edge. -1 (opponent, top edge): lift
        // drops past it — mirrored fan, see handCardSlot/HAND_ARC_* in cardLayout.ts.
        const liftSign: 1 | -1 = faceDown ? -1 : 1;

        fanCards.forEach((instance, index) =>
        {
            const container = this.cardView.createCardContainer(instance, faceDown ? 'faceDown' : 'full', undefined, false, false, resolveCardText(instance, state));
            const slot = this.handCardSlot(index, fanCards.length, layout, y, liftSign);
            container.setPosition(slot.x, slot.y);
            container.setRotation(slot.rotation);
            container.setScale(slot.scale);
            container.setDepth(slot.depth);
            this.renderedObjects.push(container);
            this.instanceContainers.set(instance.instanceId, container);

            if (faceDown) return;

            container.setInteractive(
                // See the comment in renderHero — Container hit-testing shifts the point by
                // +width/2, +height/2 first, so this must be top-left-based (0,0), not centered.
                new Geom.Rectangle(0, 0, CARD_W, CARD_H),
                Geom.Rectangle.Contains
            );
            // 'full' mode cards already print their cost on-card — no need for the tooltip to repeat it.
            this.helpBoxController.attachKeywordHover(container, instance, false, resolveCardText(instance, state));

            // Every hand card (not just currently-playable ones) gets an idle slot and can peek —
            // it's a read-only "let me see this clearly" affordance, independent of playability,
            // same spirit as the keyword tooltip above having no turn/phase gating either.
            this.handSlots.set(container, slot);

            const peekIn = () =>
            {
                // draggedContainer only covers the *active* drag — a card that was just released
                // (dragend clears draggedContainer immediately) can still have a queued animation
                // flying it elsewhere (e.g. playTargetBeginAnimation's spotlight hold), so isAnimating
                // is checked too: without it, a stray pointerover/pointerout from the mouse merely
                // moving away after drop killTweensOf's that in-flight tween — which, if something is
                // awaiting it (tweenPromise), never resolves, permanently stranding isAnimating true
                // and silently swallowing every future click via guarded(). Confirmed live: dragging a
                // targeted spell/minion out then immediately moving toward the Cancel button reliably
                // triggered exactly this softlock before this guard was added.
                if (container === this.draggedContainer || this.isAnimating) return;
                this.tweens.killTweensOf(container);
                this.tweens.add({
                    targets: container, y: PLAYER_HAND_PEEK_Y, rotation: 0, duration: 150, ease: 'Cubic.easeOut',
                    // Keeps the keyword tooltip (anchored to this card's bounds at hover-start,
                    // before this tween moves it) tracking the card as it rises, instead of staying
                    // pinned to the card's pre-peek position near the bottom of the screen.
                    onUpdate: () => this.helpBoxController.refreshPosition(container),
                });
                container.setDepth(HAND_PEEK_DEPTH);
            };
            const peekOut = () =>
            {
                // See peekIn's comment above — same reasoning applies here.
                if (container === this.draggedContainer || this.isAnimating) return;
                this.tweens.killTweensOf(container);
                const idleSlot = this.handSlots.get(container)!;
                this.tweens.add({ targets: container, y: idleSlot.y, rotation: idleSlot.rotation, duration: 150, ease: 'Cubic.easeOut' });
                container.setDepth(idleSlot.depth);
            };
            // Peek hover is driven entirely by the scene-level 'pointermove' listener in create(),
            // which walks handPeekZones and calls peekIn/peekOut on state transitions — deliberately
            // NOT by Phaser's own pointerover/pointerout on either the card or a separate zone
            // GameObject. Both were tried and both broke: wiring only a zone below the card left the
            // card's own footprint (the majority of the hoverable area) dead, because Phaser's default
            // topOnly input priority means the higher card always wins that overlap and the zone
            // underneath never sees an event there; wiring the card directly on top of the zone fixed
            // that but reintroduced pointerout events firing (or failing to fire) based on whichever
            // object happened to be topmost at each instant as the card's own hit area moved during
            // the tween, which got the card stuck permanently peeked once a pointerout was missed on
            // the way out. A manual rectangle check against the pointer's real, current world position
            // — bypassing GameObject hit-testing and topOnly altogether — is the only source of truth
            // that stays correct regardless of where the card's hit area currently is mid-animation.
            // Bounds span the card's full idle-to-peeked travel range (down through where it pokes
            // off-screen, up through PLAYER_HAND_PEEK_Y) plus HAND_PEEK_HOVER_MARGIN of breathing room
            // on top, and the original 10% width allowance for a forgiving trigger on an overlapped
            // idle card.
            const peekHalfW = (CARD_W * slot.scale * 1.1) / 2;
            this.handPeekZones.set(container, {
                left: slot.x - peekHalfW,
                right: slot.x + peekHalfW,
                top: PLAYER_HAND_PEEK_Y - (CARD_H / 2) * slot.scale - HAND_PEEK_HOVER_MARGIN,
                bottom: slot.y + (CARD_H / 2) * slot.scale + HAND_PEEK_HOVER_MARGIN,
                peeked: false,
                peekIn,
                peekOut,
            });

            if (!isMyTurn || state.phase !== TurnPhase.MainIdle) return;

            const definition = CARD_DEFINITIONS[instance.definitionId];
            if (!definition) return;
            // Aether cards have no cost to check — they're gated on the once-per-turn play limit
            // instead (see TurnStateMachine.playAetherCard's own guard, mirrored here per CLAUDE.md's
            // silent-rejection rule). Every other type keeps the affordability check.
            if (definition.type === 'aether' ? playerState.aetherPlayedThisTurn : !canAffordAetherCost(playerState, definition.cost)) return;

            // Playable: outline instead of the old dim-when-unaffordable treatment — every card
            // stays at full opacity regardless, this just marks the ones actionable right now.
            this.addShimmeringOutline(container, CARD_W, CARD_H, OUTLINE_COLOR_READY);

            // Minions and spells drag out identically — the drop location (anywhere but the hand,
            // see wireDragEvents) is what casts them, not a per-type click/drag split.
            this.cardInstanceByContainer.set(container, instance.instanceId);
            this.input.setDraggable(container);
        });

        if (heldCard)
        {
            const container = this.cardView.createCardContainer(heldCard, 'full', undefined, false, false, resolveCardText(heldCard, state));
            container.setPosition(SPOTLIGHT_X, CENTER_Y);
            container.setScale(1.25);
            container.setDepth(2500);
            this.renderedObjects.push(container);
            this.instanceContainers.set(heldCard.instanceId, container);
            this.addShimmeringOutline(container, CARD_W, CARD_H, OUTLINE_COLOR_TARGETABLE);
            // No interactivity: this card is mid-cast — the player backs out via the Cancel button.
        }
    }

    private renderBoard (ownerId: PlayerId, playerState: PlayerState, y: number): void
    {
        const cards = playerState.board;
        if (cards.length === 0) return;

        const { spacing, startX } = this.rowLayout(cards.length, 25);
        const state = this.machine.state;

        cards.forEach((instance, index) =>
        {
            const isSummoningSick = ownerId === 'player' && instance.summoningSick && !hasKeyword(instance, 'charge');
            // Unlike summoning sickness (only meaningful for the player's own board — it's about
            // whether *you* can act with this card), frozen is informative for either side: an
            // enemy minion frozen by e.g. Glacial Grasp can't attack either, and the player needs
            // to see that.
            const isFrozen = instance.frozen;
            const definition = CARD_DEFINITIONS[instance.definitionId];
            // Computed off this board's own owner's untapped generic Aether (not necessarily
            // 'player') so an enemy minion's badge still shows correctly-dimmed cost — separate
            // from canActivateAbilities below, which additionally gates whether it's actually
            // clickable right now.
            const abilityAffordability = definition?.paidAbilities?.map((ability) => countUntappedPlain(playerState) >= ability.cost);

            const container = this.cardView.createCardContainer(instance, 'simplified', undefined, isSummoningSick, isFrozen, resolveCardText(instance, state), abilityAffordability);
            container.setPosition(startX + index * spacing, y);
            this.renderedObjects.push(container);
            this.instanceContainers.set(instance.instanceId, container);

            container.setInteractive(
                // See the comment in renderHero — Container hit-testing shifts the point by
                // +width/2, +height/2 first, so this must be top-left-based (0,0), not centered.
                new Geom.Rectangle(0, 0, CARD_W, CARD_H),
                Geom.Rectangle.Contains
            );
            // 'simplified' mode never prints cost on-card — the tooltip is the only place to see it.
            this.helpBoxController.attachKeywordHover(container, instance, true, resolveCardText(instance, state));

            // See the matching comment in renderHero — only the true owner of this pending prompt
            // (state.pendingTarget.ownerId, not necessarily state.activePlayer) may resolve it.
            const isValidTarget =
                state.phase === TurnPhase.AwaitingTarget &&
                state.pendingTarget?.ownerId === 'player' &&
                state.pendingTarget?.validTargetIds.includes(instance.instanceId);
            const canAttack =
                state.phase === TurnPhase.MainIdle &&
                ownerId === 'player' &&
                state.activePlayer === 'player' &&
                canDeclareAttack(instance);

            if (isValidTarget)
            {
                this.addShimmeringOutline(container, CARD_W, CARD_H, OUTLINE_COLOR_TARGETABLE);
                // See the matching comment on the hero's own selectTarget handler — this can
                // cascade into a new opponent-owned Tier-2 prompt that needs draining too.
                container.on('pointerup', this.guarded(() => { this.machine.selectTarget(instance.instanceId); this.drainOpponentTargeting(); }));
            }
            else if (canAttack)
            {
                this.addShimmeringOutline(container, CARD_W, CARD_H, OUTLINE_COLOR_READY);
                container.on('pointerup', this.guarded(() => this.machine.declareAttack(instance.instanceId)));
            }
            else
            {
                // Both branches below can fire together (a minion can be frozen AND summoning-sick) —
                // see CLAUDE.md's "silent state-machine rejection" gotcha for why every reason a
                // minion can't act needs its own cue, not just the first one checked.
                if (isSummoningSick) this.addStaticOutline(container, CARD_W, CARD_H, OUTLINE_COLOR_SICK);
                if (isFrozen) this.addStaticOutline(container, CARD_W, CARD_H, OUTLINE_COLOR_FROZEN, isSummoningSick ? 10 : 5);
            }

            // Paid-ability badges: a separate clickable Zone per badge, independent from the card
            // body's own click handling above (attack/select-target) — not blocked by summoning
            // sickness/frozen (see PaidAbility's doc comment, Card.ts), only by whose turn/phase it
            // is and whether it's affordable right now.
            if (definition?.paidAbilities && definition.paidAbilities.length > 0)
            {
                const canActivateAbilities =
                    state.phase === TurnPhase.MainIdle &&
                    ownerId === 'player' &&
                    state.activePlayer === 'player';

                this.cardView.abilityBadgeLayout(definition).forEach((pos, abilityIndex) =>
                {
                    const ability = definition.paidAbilities![abilityIndex];
                    const affordable = countUntappedPlain(playerState) >= ability.cost;
                    const zone = this.add.zone(container.x + pos.x, container.y + pos.y, COST_BADGE_R_FULL * 2, COST_BADGE_R_FULL * 2);
                    this.renderedObjects.push(zone);

                    if (canActivateAbilities && affordable)
                    {
                        zone.setInteractive({ useHandCursor: true });
                        // A no-target-needed ability resolves fully synchronously here and can
                        // itself cascade into an opponent-owned Tier-2 prompt (e.g. it kills the
                        // AI's own Deathcry minion) — drain it reactively, same as playCard below.
                        zone.on('pointerup', this.guarded(() => { this.machine.activateAbility(instance.instanceId, abilityIndex); this.drainOpponentTargeting(); }));
                    }
                });
            }
        });
    }

    // The 4 elemental categories, in play order — generic Aether isn't part of this stack at all
    // (see renderAetherMarker), it gets its own round pool marker instead. Shared by
    // renderAetherInPlay, aetherPileRow, and computeAetherPileDestination so all three agree on
    // pile order.
    private static readonly AETHER_PILE_CATEGORIES: AetherCategory[] = ['fire', 'water', 'earth', 'air'];

    /** Index (skipping categories with zero cards in play) of `category` among playerState's
     * Aether-in-play piles, in AETHER_PILE_CATEGORIES order — see aetherPileSlot. */
    private aetherPileRow (playerState: PlayerState, category: AetherCategory): number
    {
        let row = 0;
        for (const c of CardGame.AETHER_PILE_CATEGORIES)
        {
            if (c === category) return row;
            if (playerState.aetherInPlay.some((card) => CARD_DEFINITIONS[card.definitionId]?.aetherCategory === c)) row++;
        }
        return row;
    }

    /** Fixed x (AETHER_ROW_X_START) plus the row-th vertical slot, growing from that side's own
     * screen edge (row 0) toward screen center as row increases — see
     * OPPONENT_AETHER_ROW_START_Y/PLAYER_AETHER_ROW_START_Y's doc comment in cardLayout.ts. Shared
     * by renderAetherInPlay (actual layout) and computeAetherPileDestination (a just-played
     * elemental Aether card's flight target), so the two can't drift apart. */
    private aetherPileSlot (playerId: PlayerId, row: number): { x: number; y: number }
    {
        const y = playerId === 'opponent'
            ? OPPONENT_AETHER_ROW_START_Y + row * AETHER_ROW_SPACING
            : PLAYER_AETHER_ROW_START_Y - row * AETHER_ROW_SPACING;
        return { x: AETHER_ROW_X_START, y };
    }

    /** The round generic-Aether marker's fixed position — beside the elemental column's row 0
     * (same edge-aligned Y), offset AETHER_MARKER_OFFSET_X to the right. Shared by
     * renderAetherMarker (actual layout) and computeAetherPileDestination (a just-played generic
     * Aether card's flight target), so the two can't drift apart. */
    private aetherMarkerSlot (playerId: PlayerId): { x: number; y: number }
    {
        const { y } = this.aetherPileSlot(playerId, 0);
        return { x: AETHER_ROW_X_START + AETHER_MARKER_OFFSET_X, y };
    }

    /**
     * A side's elemental Aether-in-play, one small pile per category present — fire, water,
     * earth, air in play order — rather than a row of individual cards. Reuses the
     * Deck/Graveyard/Aether Deck piles' own DECK_PILE_W/H footprint instead of CardView's full
     * card render: a resource base reads at a glance and doesn't need to compete for the same
     * visual weight as an actual battlefield minion (see renderBoard). Shows only the most
     * recently played card's own art (falling back to the flat category color when its art isn't
     * loaded yet) — no offset stack, since the count text already says how many are in the pile
     * and a second/third card peeking out underneath added visual noise without new information.
     * Stacks vertically (see aetherPileSlot); a category with zero cards in play is skipped
     * entirely (not drawn empty), so the column never shows a gap for a category this side hasn't
     * drawn into yet.
     */
    private renderAetherInPlay (playerState: PlayerState): void
    {
        const state = this.machine.state;

        for (const category of CardGame.AETHER_PILE_CATEGORIES)
        {
            const cards = playerState.aetherInPlay.filter((c) => CARD_DEFINITIONS[c.definitionId]?.aetherCategory === category);
            if (cards.length === 0) continue;

            const { x, y } = this.aetherPileSlot(playerState.id, this.aetherPileRow(playerState, category));

            const fill = AETHER_CATEGORY_COLOR[category];
            const stroke = lightenColor(fill, 0.4);
            const container = this.add.container(x, y);

            const topCard = cards[cards.length - 1];
            let layerCard: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
            if (this.textures.exists(topCard.definitionId))
            {
                layerCard = this.add.image(0, 0, topCard.definitionId);
                coverFit(layerCard, DECK_PILE_W, DECK_PILE_H);
            }
            else
            {
                layerCard = this.add.rectangle(0, 0, DECK_PILE_W, DECK_PILE_H, fill).setStrokeStyle(2, stroke);
            }
            container.add(layerCard);

            // An elemental threshold is a pure presence check, never satisfied by tapping/
            // consuming (see aether.ts's countCategory) — so unlike the generic pool marker, the
            // count here is always every card in the pile, tapped or not.
            container.add(this.add.text(0, 0, `${cards.length}`, statStyle('#ffffff', true, '22px')).setOrigin(0.5));

            const hitW = DECK_PILE_W + 16, hitH = DECK_PILE_H + 16;
            container.setSize(hitW, hitH);
            container.setInteractive({
                hitArea: new Geom.Rectangle(0, 0, hitW, hitH),
                hitAreaCallback: Geom.Rectangle.Contains,
                useHandCursor: true,
            });

            // Representative instance for the hover tooltip — the most recently played card of
            // this category — good enough since same-category Aether cards share the same
            // threshold-facing identity even when their printed names differ.
            this.helpBoxController.attachKeywordHover(container, topCard, true, resolveCardText(topCard, state));

            // Tapped outline only when every card in the pile is tapped right now — a pile mixing
            // tapped/untapped cards (mid-spend) still reads as available, matching how
            // countUntappedPlain treats it (see aether.ts), rather than showing a misleading
            // partial-tapped state on the stack.
            if (cards.every((c) => c.tapped)) this.addStaticOutline(container, DECK_PILE_W, DECK_PILE_H, OUTLINE_COLOR_TAPPED);

            this.renderedObjects.push(container);
        }
    }

    /**
     * A side's generic-Aether pool — always rendered (unlike an elemental pile, it doesn't hide
     * at 0 cards, since it's the resource every deck spends most often) as a single round marker
     * reusing the on-card cost badge's gradient-circle-plus-stroke recipe, just bigger
     * (AETHER_MARKER_R vs COST_BADGE_R_FULL). Fixed beside the elemental column (aetherMarkerSlot)
     * rather than inside it, so its position never depends on how many elemental piles are
     * currently in play. Shows the untapped ("available to spend") count on the badge itself;
     * hover reveals both that and the total ("max") count — see HelpBoxController.attachTextHover.
     */
    private renderAetherMarker (playerState: PlayerState): void
    {
        const { x, y } = this.aetherMarkerSlot(playerState.id);

        const generic = playerState.aetherInPlay.filter((c) => CARD_DEFINITIONS[c.definitionId]?.aetherCategory === 'generic');
        const available = generic.filter((c) => !c.tapped).length;
        const max = generic.length;

        const container = this.add.container(x, y);
        const badge = this.add.graphics();
        badge.fillGradientStyle(COST_BADGE_LIGHT, COST_BADGE_LIGHT, COST_BADGE_DARK, COST_BADGE_DARK, 1, 1, 1, 1);
        badge.fillCircle(0, 0, AETHER_MARKER_R);
        badge.lineStyle(COST_BADGE_STROKE_WIDTH, COST_BADGE_STROKE_COLOR, 1);
        badge.strokeCircle(0, 0, AETHER_MARKER_R);
        container.add(badge);
        container.add(this.add.text(0, 0, `${available}`, statStyle('#ffffff', true, '22px')).setOrigin(0.5));

        // Container hit areas are top-left-based, not centered on the container's local origin —
        // setSize gives this container a displayOrigin of (hitR, hitR), so the hit circle must be
        // defined in that shifted space (center at (hitR, hitR)), not at local (0, 0) where the
        // badge is actually drawn. Matches the elemental piles' own Geom.Rectangle(0, 0, w, h) for
        // the same reason.
        const hitR = AETHER_MARKER_R + 8;
        container.setSize(hitR * 2, hitR * 2);
        container.setInteractive({
            hitArea: new Geom.Circle(hitR, hitR, hitR),
            hitAreaCallback: Geom.Circle.Contains,
            useHandCursor: true,
        });

        this.helpBoxController.attachTextHover(container, [`Available Aether: ${available}`, `Max Aether: ${max}`]);

        this.renderedObjects.push(container);
    }

    private updateEndTurnButton (state: GameState): void
    {
        const enabled = state.activePlayer === 'player' && state.phase === TurnPhase.MainIdle;
        this.endTurnButton.setAlpha(enabled ? 1 : 0.4);
        if (enabled) this.endTurnButton.setInteractive({ useHandCursor: true });
        else this.endTurnButton.disableInteractive();
    }

    private updateCancelButton (state: GameState): void
    {
        this.cancelButton.setVisible(state.phase === TurnPhase.AwaitingTarget && state.pendingTarget?.cancellable !== false);
    }

    private showGameOver (winner?: PlayerId): void
    {
        const overlay = this.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6);
        const label = this.add.text(CENTER_X, 478, winner === 'player' ? 'Victory!' : 'Defeat', {
            fontFamily: 'Arial Black', fontSize: 90, color: '#ffffff',
            stroke: '#000000', strokeThickness: 11, align: 'center'
        }).setOrigin(0.5);
        const button = this.add.text(CENTER_X, 591, 'Play Again', {
            fontFamily: 'Arial', fontSize: '32px', color: '#ffffff', backgroundColor: '#3a4a6b'
        }).setOrigin(0.5).setPadding(20, 10, 20, 10).setInteractive({ useHandCursor: true });
        button.on('pointerup', () => this.scene.restart());

        this.renderedObjects.push(overlay, label, button);
    }

    /**
     * Draws a colored border whose own material sweeps light→bright→light along the bottom-left→
     * top-right diagonal, twice in quick succession, then pauses, then repeats. Replaces the old
     * static outline for every highlight in this file — any future color variant is just a new call
     * with a different hex, via OUTLINE_COLOR_* in cardLayout.ts.
     *
     * The border is a Graphics frame (4 filled strips, not a Rectangle+strokeStyle) so each strip
     * can be painted with fillGradientStyle's per-corner colors — a WebGL-only Phaser feature this
     * project already relies on elsewhere (see CardView.ts's createHeaderGradient) since the AUTO
     * renderer type resolves to WebGL in real browsers. Every vertex's color is a pure function of
     * its (x, y) position (see `colorAt`), so shared corners between adjacent strips always compute
     * identically — no visible seam at the frame's 4 corners.
     *
     * The tween targets the frame GameObject directly via a plain custom `shimmerCycle` property
     * (0-1 progress through one full sweep-sweep-pause cycle) rather than a detached proxy object:
     * this file has no existing pattern for manually killing tweens on renderNow()'s teardown (see
     * clearRendered()), so every tween here — including this one — relies on Phaser's own
     * auto-cleanup, which only fires for a tween's direct GameObject target. A proxy target would
     * have no such lifecycle and leak one runaway repeat(-1) tween per historical outline for the
     * rest of the session. Driving the whole sweep-sweep-pause cycle off one repeating tween (rather
     * than chaining sweeps with time.delayedCall) keeps that same guarantee — a delayedCall timer
     * isn't a tween and isn't covered by the destroy cascade, so it would need its own manual
     * teardown wiring that nothing else in this file has.
     *
     * Returns a handle to tear the outline down early (stopping the tween and destroying the
     * frame) — every static-render call site here ignores it, relying on the auto-cleanup above,
     * but a transient hover highlight (see renderPile) needs to remove its shimmer on pointerout
     * without waiting for the next renderNow() teardown.
     */
    /** Plain, unanimated border frame — same w+10/h+10 default sizing convention as addShimmeringOutline (so it
     * reads as the same "outline" visual language) but drawn once with no tween, since these mark passive
     * statuses (summoning sickness, frozen) rather than something the player can act on right now. `margin`
     * lets two statuses that can both be true at once (a minion can be frozen AND summoning-sick) render as
     * concentric rings instead of one flat color silently overdrawing the other. */
    private addStaticOutline (container: Phaser.GameObjects.Container, width: number, height: number, color: number, margin = 5): void
    {
        const frame = this.add.graphics();
        frame.lineStyle(4, color, 1);
        frame.strokeRect(-width / 2 - margin, -height / 2 - margin, width + margin * 2, height + margin * 2);
        container.addAt(frame, 0);
    }

    private addShimmeringOutline (container: Phaser.GameObjects.Container, width: number, height: number, color: number): { destroy: () => void }
    {
        const w = width + 10, h = height + 10;
        const halfW = w / 2, halfH = h / 2;
        const strokeWidth = 4;

        // Diagonal axis (bottom-left → top-right) the shimmer sweeps along: project any frame vertex
        // onto a single 0..diagLen scalar, then measure the sweep's current peak against it.
        const diagLen = Math.hypot(w, h);
        const dirX = w / diagLen, dirY = -h / diagLen;
        const originX = -halfW, originY = halfH; // bottom-left corner == s(0)
        const project = (x: number, y: number) => (x - originX) * dirX + (y - originY) * dirY;

        const colorAt = (x: number, y: number, peakS: number | null): number =>
        {
            if (peakS === null) return color;
            const brightness = Math.max(0, 1 - Math.abs(project(x, y) - peakS) / SHIMMER_BAND_WIDTH);
            return lightenColor(color, brightness * SHIMMER_BRIGHTEN_AMOUNT);
        };

        const frame = this.add.graphics() as Phaser.GameObjects.Graphics & { shimmerCycle: number };
        frame.shimmerCycle = 0;
        container.addAt(frame, 0);

        const strips: [number, number, number, number][] = [
            [-halfW, -halfH, w, strokeWidth], // top
            [-halfW, halfH - strokeWidth, w, strokeWidth], // bottom
            [-halfW, -halfH, strokeWidth, h], // left
            [halfW - strokeWidth, -halfH, strokeWidth, h], // right
        ];
        const drawFrame = (peakS: number | null) =>
        {
            frame.clear();
            for (const [x, y, sw, sh] of strips)
            {
                frame.fillGradientStyle(
                    colorAt(x, y, peakS), colorAt(x + sw, y, peakS),
                    colorAt(x, y + sh, peakS), colorAt(x + sw, y + sh, peakS), 1
                );
                frame.fillRect(x, y, sw, sh);
            }
        };

        // One repeating tween drives the whole cycle: two quick sweeps (each SHIMMER_SWEEP_MS) back
        // to back, then a flat-color pause (SHIMMER_PAUSE_MS) before it loops.
        const redraw = () => drawFrame(this.shimmerPeakAt(frame.shimmerCycle, diagLen));

        drawFrame(null);
        const cycleMs = SHIMMER_SWEEP_MS * 2 + SHIMMER_PAUSE_MS;
        const tween = this.tweens.add({ targets: frame, shimmerCycle: 1, duration: cycleMs, repeat: -1, ease: 'Linear', onUpdate: redraw });
        // Random phase so multiple simultaneous shimmers (e.g. several attackable minions at once)
        // don't all sweep in lockstep. seek() takes ms (not the old 0-1 fraction) and doesn't fire
        // onUpdate while fast-forwarding, so redraw() once more manually right after — otherwise the
        // frame sits at its cycle-start appearance for up to a frame, and this spawn path recurs
        // constantly (renderNow() reruns on every state change, and every ~600ms during the
        // opponent's turn), so it's worth the extra line rather than a once-off cosmetic nit.
        tween.seek(Math.random() * cycleMs);
        redraw();

        return { destroy: () => { tween.stop(); frame.destroy(); } };
    }

    /**
     * Where the shimmer's bright band currently sits along a diagonal of length `diagLen`, given
     * `cycleT` (0-1 progress through addShimmeringOutline/addShimmeringFill's shared sweep-sweep-
     * pause cycle) — shared so both methods' redraw loops stay in step with the same timing.
     */
    private shimmerPeakAt (cycleT: number, diagLen: number): number | null
    {
        const sweepFrac = SHIMMER_SWEEP_MS / (SHIMMER_SWEEP_MS * 2 + SHIMMER_PAUSE_MS);
        if (cycleT < sweepFrac) return -SHIMMER_BAND_WIDTH + (diagLen + SHIMMER_BAND_WIDTH * 2) * (cycleT / sweepFrac);
        if (cycleT < sweepFrac * 2) return -SHIMMER_BAND_WIDTH + (diagLen + SHIMMER_BAND_WIDTH * 2) * ((cycleT - sweepFrac) / sweepFrac);
        return null;
    }

    /**
     * Same shimmer sweep as addShimmeringOutline, but filling a solid disc rather than tracing a
     * border — used for the active player's hero circle, whose own fill shimmers instead of
     * getting an outline glow. Phaser's gradient fill only interpolates cleanly across a single
     * quad (see addShimmeringOutline's per-strip fillRect calls); a circle has no such quad, so
     * this instead triangulates the disc into pie slices from its center and fills each slice with
     * a single flat color sampled at its midpoint — enough slices reads as a smooth sweep at this
     * circle's size, in the same spirit as the border's own 4-strip approximation of a continuous
     * gradient.
     */
    private addShimmeringFill (container: Phaser.GameObjects.Container, radius: number, color: number): { destroy: () => void }
    {
        const sliceCount = 40;

        // Diagonal axis (bottom-left → top-right) of the disc's bounding square — same convention
        // as addShimmeringOutline's `project`.
        const diagLen = radius * 2 * Math.SQRT2;
        const dirX = Math.SQRT1_2, dirY = -Math.SQRT1_2;
        const originX = -radius, originY = radius;
        const project = (x: number, y: number) => (x - originX) * dirX + (y - originY) * dirY;

        const colorAt = (x: number, y: number, peakS: number | null): number =>
        {
            if (peakS === null) return color;
            const brightness = Math.max(0, 1 - Math.abs(project(x, y) - peakS) / SHIMMER_BAND_WIDTH);
            return lightenColor(color, brightness * SHIMMER_BRIGHTEN_AMOUNT);
        };

        const disc = this.add.graphics() as Phaser.GameObjects.Graphics & { shimmerCycle: number };
        disc.shimmerCycle = 0;
        container.addAt(disc, 0);

        const drawDisc = (peakS: number | null) =>
        {
            disc.clear();
            for (let i = 0; i < sliceCount; i++)
            {
                const a0 = (i / sliceCount) * Math.PI * 2;
                const a1 = ((i + 1) / sliceCount) * Math.PI * 2;
                const x1 = Math.cos(a0) * radius, y1 = Math.sin(a0) * radius;
                const x2 = Math.cos(a1) * radius, y2 = Math.sin(a1) * radius;
                disc.fillStyle(colorAt((x1 + x2) / 2, (y1 + y2) / 2, peakS), 1);
                disc.fillTriangle(0, 0, x1, y1, x2, y2);
            }
        };

        const redraw = () => drawDisc(this.shimmerPeakAt(disc.shimmerCycle, diagLen));

        drawDisc(null);
        const cycleMs = SHIMMER_SWEEP_MS * 2 + SHIMMER_PAUSE_MS;
        const tween = this.tweens.add({ targets: disc, shimmerCycle: 1, duration: cycleMs, repeat: -1, ease: 'Linear', onUpdate: redraw });
        tween.seek(Math.random() * cycleMs);
        redraw();

        return { destroy: () => { tween.stop(); disc.destroy(); } };
    }
}
