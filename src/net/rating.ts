// ══════════════════════════════════════════════════════════════════════════
// RANK-01 — the rating: an Elo number, the tier it names, and the arithmetic
// that moves it.
//
// This module is deliberately PURE and SDK-free. It is imported by the client,
// by the room (`src/rooms/HexmatchRoom.ts`) and by the unit suite, so it may
// not touch `localStorage`, the RUN SDK, the DOM, or the clock. Everything a
// caller needs to know is an argument or a return value.
//
// THE SHAPE OF A RATED RESULT
//
//   A match ends in exactly one of three ways, and each has a policy:
//
//     1. someone reached the star line   → the winner's rating rises, the
//                                          loser's falls (§ `rateMatch`);
//     2. the board was abandoned         → the LEAVER loses, the stayer gains,
//                                          the same arithmetic as a loss;
//     3. AI / story / casual rooms       → nothing is rated at all.
//
//   (2) is the one that needs justifying. A rating system that ignored
//   abandonment would make quitting strictly better than losing, and the ladder
//   would fill with people who leave the moment a match turns. Since a match
//   here is a racing game with a clear scoreboard, "the leaver loses" is both
//   the fair reading and the only one that is not farmable. The stayer is paid
//   as if the leaver had conceded — because on the scoreboard they did.
//
// WHO RUNS THE ARITHMETIC, AND WHY BOTH SIDES AGREE
//
//   Both clients arrive at the SAME numbers from the SAME inputs, because the
//   inputs are the ratings the room itself holds. Each player publishes its
//   rating once, on join (`PlayerRatingMsg`), and the room stamps it into the
//   roster. When the match is filed:
//
//     both sides compute  rateMatch(myBefore, theirBefore)
//     the winner adopts the `winner` half, the loser the `loser` half.
//
//   No client is trusted for anyone's number — the room's copy is the shared
//   one. The result message carries NO rating numbers at all: it names the two
//   seats, and each side recomputes the same two halves from the board the room
//   stamped, so a room cannot hand out a verdict the arithmetic does not
//   produce from the numbers both players published.
//
//   What protects the stored file is that only the ROOM's result moves it. A
//   client is free to rewrite its own storage — it owns that bucket — but it
//   cannot move anyone else's, and it cannot make the ladder say something the
//   board has not seen: the public number is written from a room-witnessed
//   result (`src/net/rankstore.ts`), and the leaderboard keeps the best
//   submission of a season. Ratings rank and decorate; they gate nothing.
//
// WHY ELO AND NOT SOMETHING ELSE
//
//   The issue asks for chess-style Elo, and it is the right primitive here:
//   matches are pairwise, the score is decisive (no draws), and two players per
//   room means the rating pool does not need to be consulted at all. The two
//   knobs are the START (1000) and the K-factor, which is halved once a player
//   is ESTABLISHED so a long-standing rating stops swinging on one bad night.
// ══════════════════════════════════════════════════════════════════════════

/** The rating a player starts at — the issue's number, and a round one. */
export const START_RATING = 1000;

/**
 * K-factor while PROVISIONAL: the first `PROVISIONAL_MATCHES` rated games.
 * A new player's rating is a guess, so it is allowed to move fast to find the
 * right neighbourhood. 40/16 is the classic chess pairing of the two values.
 */
export const K_PROVISIONAL = 40;
export const K_ESTABLISHED = 16;

/** Rated matches after which a player is no longer provisional. */
export const PROVISIONAL_MATCHES = 10;

/**
 * Floor. Ratings never go below this: a rating that can run to zero turns a
 * bad start into a hole a new player cannot climb out of, and the ladder is
 * supposed to be a road back up. There is deliberately NO ceiling — the top of
 * the ladder is open, and Master is the last NAMED tier, not the last rating.
 */
export const RATING_FLOOR = 100;

/**
 * Rank tiers, lowest first. `min` is inclusive; the tier runs up to the next
 * tier's `min`. The keys are the badge file names in `src/assets/ui/rank/`
 * (derived by `tools/make-rank-badges.mjs`) and MUST stay in step with them —
 * `tests/unit/net-rank.test.ts` asserts the table against the files on disk.
 *
 * Bands are 150 wide up to Diamond and open-ended at Master, which puts the
 * 1000 start in the middle of Bronze: everyone begins at the bottom and the
 * first few wins are the promotion. `unranked` is NOT in this table — it is a
 * state (no rated match filed yet), not a band; see `rankKeyOf`.
 */
export interface RankTier {
  key: string;
  label: string;
  /** Lowest rating in the band. */
  min: number;
  /** One line for the ladder panel / the badge's tooltip. */
  blurb: string;
}

export const RANK_TIERS: readonly RankTier[] = [
  { key: "bronze", label: "Bronze", min: 0, blurb: "Learning the freight lanes." },
  { key: "silver", label: "Silver", min: 1100, blurb: "A network that pays its way." },
  { key: "gold", label: "Gold", min: 1250, blurb: "Paving before the rival wakes up." },
  { key: "platinum", label: "Platinum", min: 1400, blurb: "Ore in, stars out, every shift." },
  { key: "diamond", label: "Diamond", min: 1550, blurb: "The map bends around the network." },
  { key: "master", label: "Master", min: 1750, blurb: "Chairman of the Syndicate." },
];

/** The badge shown to a player with no rated match yet. */
export const UNRANKED_KEY = "unranked";
export const UNRANKED_LABEL = "Unranked";

/**
 * A player's stored rating, as it lives in RUN player storage
 * (`appStorage`, key `hexmatch:rank:v1`). Every field is required and every
 * one is clamped by `parseRankState`: storage is shared with older builds of
 * this game and with whatever a future build wrote, and a rating file is not
 * the place to throw.
 */
export interface RankState {
  /** The Elo number. */
  rating: number;
  /** Rated matches played (the provisional counter). */
  matches: number;
  wins: number;
  losses: number;
  /**
   * The season this rating belongs to. SEASONS ARE NOT SHIPPED YET (#147
   * decided "seam only"): this exists so that a future reset is a
   * `state.season !== CURRENT_SEASON → soft reset` branch rather than a
   * migration over an unversioned number. `RANK_SEASON` is the only value the
   * game writes today.
   */
  season: string;
}

export const RANK_SEASON = "s1";

export const freshRankState = (rating = START_RATING): RankState => ({
  rating: clampRating(rating),
  matches: 0,
  wins: 0,
  losses: 0,
  season: RANK_SEASON,
});

export function clampRating(rating: number): number {
  if (!Number.isFinite(rating)) return START_RATING;
  return Math.max(RATING_FLOOR, Math.round(rating));
}

/** Tier for a rating. Never null: below Bronze's floor is still Bronze. */
export function rankOf(rating: number): RankTier {
  const r = clampRating(rating);
  let tier = RANK_TIERS[0];
  for (const candidate of RANK_TIERS) if (r >= candidate.min) tier = candidate;
  return tier;
}

/**
 * The badge key to print: `unranked` until the first rated match is filed,
 * then the tier. A 0-match file and a missing file look the same to the UI,
 * which is the point — one badge for "not yet", one per band after it.
 */
export function rankKeyOf(state: Pick<RankState, "rating" | "matches">): string {
  return state.matches > 0 ? rankOf(state.rating).key : UNRANKED_KEY;
}

export function rankLabelOf(state: Pick<RankState, "rating" | "matches">): string {
  return state.matches > 0 ? rankOf(state.rating).label : UNRANKED_LABEL;
}

export interface TierProgress {
  tier: RankTier;
  /** The next tier, or null at the top of the ladder. */
  next: RankTier | null;
  /** 0–1 through the current band. 1 at the top of the ladder. */
  fraction: number;
  /** Rating still needed for `next` (0 when there is no next). */
  toNext: number;
}

export function tierProgress(rating: number): TierProgress {
  const r = clampRating(rating);
  const tier = rankOf(r);
  const i = RANK_TIERS.indexOf(tier);
  const next = i + 1 < RANK_TIERS.length ? RANK_TIERS[i + 1] : null;
  if (!next) return { tier, next: null, fraction: 1, toNext: 0 };
  const span = next.min - tier.min;
  const into = r - tier.min;
  return {
    tier,
    next,
    fraction: span <= 0 ? 1 : Math.min(1, Math.max(0, into / span)),
    toNext: Math.max(0, next.min - r),
  };
}

/** Provisional players move fast; established ones move carefully. */
export const kFactor = (matches: number): number =>
  matches < PROVISIONAL_MATCHES ? K_PROVISIONAL : K_ESTABLISHED;

/** The classic Elo expectation: 1 for a certain win, 0.5 for an even match. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** One side of a rated result. */
export interface RatingChange {
  id: string;
  before: number;
  after: number;
  /** Signed: positive on a win, negative on a loss. Never 0 on a rated match. */
  delta: number;
  k: number;
}

export interface RatedResult {
  winner: RatingChange;
  loser: RatingChange;
}

/** The two sides' inputs. `matches` drives K, so it is not optional. */
export interface RatedPlayer {
  id: string;
  rating: number;
  matches: number;
}

/**
 * The arithmetic, for both sides at once — one call so the two halves can
 * never be computed from different expectations (the classic Elo bug: updating
 * the winner's rating first and then reading it as the loser's opponent).
 *
 * Rounds to whole points: the HUD prints integers, and a rating that carries
 * decimals into storage makes "±1" drift invisible for months.
 */
export function rateMatch(winner: RatedPlayer, loser: RatedPlayer): RatedResult {
  const wBefore = clampRating(winner.rating);
  const lBefore = clampRating(loser.rating);
  const wExpected = expectedScore(wBefore, lBefore);
  const wK = kFactor(winner.matches);
  const lK = kFactor(loser.matches);
  const wAfter = clampRating(wBefore + wK * (1 - wExpected));
  const lAfter = clampRating(lBefore + lK * (0 - (1 - wExpected)));
  return {
    winner: { id: winner.id, before: wBefore, after: wAfter, delta: wAfter - wBefore, k: wK },
    loser: { id: loser.id, before: lBefore, after: lAfter, delta: lAfter - lBefore, k: lK },
  };
}

export interface FiledResult {
  /** The rating file after the match. */
  state: RankState;
  /** The half of `rateMatch` that belongs to this player. */
  change: RatingChange;
  /** The opponent's new rating, for the end-of-match screen. */
  opponentAfter: number;
  promoted: boolean;
  demoted: boolean;
  tierBefore: RankTier;
  tierAfter: RankTier;
}

/**
 * Fold a win or a loss into a player's own rating file. `opponent` comes from
 * the shared rating board the room holds (`src/rooms/HexmatchRoom.ts`, folded
 * into the client by `src/net/session.ts`), so the two halves of one match are
 * computed from identical inputs on both seats.
 *
 * A promotion is reported only when the tier key actually changes — crossing
 * from `unranked` to Bronze on the first match is reported as a promotion,
 * which is what a player expects to see.
 */
export function applyResult(
  state: RankState,
  won: boolean,
  opponent: RatedPlayer,
  self: { id: string },
): FiledResult {
  const me: RatedPlayer = { id: self.id, rating: state.rating, matches: state.matches };
  const rated = rateMatch(won ? me : opponent, won ? opponent : me);
  const change = won ? rated.winner : rated.loser;
  const opponentAfter = (won ? rated.loser : rated.winner).after;
  const tierBefore = rankOf(state.rating);
  const keyBefore = rankKeyOf(state);
  const next: RankState = {
    rating: change.after,
    matches: state.matches + 1,
    wins: state.wins + (won ? 1 : 0),
    losses: state.losses + (won ? 0 : 1),
    season: RANK_SEASON,
  };
  const tierAfter = rankOf(next.rating);
  return {
    state: next,
    change,
    opponentAfter,
    promoted: rankKeyOf(next) !== keyBefore && next.rating > state.rating,
    demoted: rankKeyOf(next) !== keyBefore && next.rating < state.rating,
    tierBefore,
    tierAfter,
  };
}

/**
 * The local write rule: the NEWER file wins, and `matches` is what "newer"
 * means.
 *
 * `filed` is a file this client computed from a room-witnessed result, so it
 * moves the rating in whichever direction the match did — a loss LOWERS it,
 * which is the whole point of a rating. What must never happen is an OLD file
 * overwriting a newer one: two tabs, a device that was offline, or a late
 * `result` from a previous match can all hand this function a state built from
 * a shorter history, and the longer history is the truth. So the comparison is
 * on the match COUNT, not on the number.
 *
 * A season change replaces outright: the reset recipe is
 * `{ rating: START_RATING, matches: 0, wins: 0, losses: 0, season: <new> }`,
 * and after a reset the new file is the truth however it compares.
 */
export function advanceRating(current: RankState | null, filed: RankState): RankState {
  if (!current) return filed;
  if (filed.season !== current.season) return filed;      // a season seam replaces
  if (filed.matches < current.matches) return current;    // a stale file: the newer history stands
  return filed;
}

/**
 * RANK-01 matchmaking (#147): the pool's criterion value for a similar-rank
 * SEARCH WINDOW, or null for "any rank".
 *
 * The matchmaker matches criteria by equality — there is no range operator on
 * the wire (`MatchmakeOptions.criteria` is flat string/number keys) — so a
 * window is expressed as a BUCKET: everyone whose rating rounds into the same
 * bucket is, by the pool's reckoning, similar. The window is therefore always
 * a little wider than `span` (a player 1 point across a boundary misses the
 * first bucket and is caught by the next window), which is exactly why the
 * search WIDENS over time instead of stopping at one window.
 *
 * A span of 0 (or anything not positive) means Any rank: no criterion at all.
 */
export function searchBucket(rating: number, span: number): number | null {
  if (!(span > 0)) return null;
  return Math.round(clampRating(rating) / span);
}

/** "1042" — the rating as the HUD prints it. */
export const fmtRating = (rating: number): string => String(clampRating(rating));

/** "+18" / "−14" — signed, with the typographic minus the rest of the HUD uses. */
export const fmtRatingDelta = (delta: number): string =>
  `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))}`;

/** "1042 · Gold" or "Unranked · placement 3/10" — one line for a seat row. */
export function rankSummary(state: RankState): string {
  if (state.matches === 0) return `${UNRANKED_LABEL} · placement`;
  const provisional = state.matches < PROVISIONAL_MATCHES
    ? ` · ${PROVISIONAL_MATCHES - state.matches} to go`
    : "";
  return `${fmtRating(state.rating)} · ${rankLabelOf(state)}${provisional}`;
}

/** Win rate as the ladder prints it. `—` until there is something to divide. */
export function winRate(state: RankState): string {
  const played = state.wins + state.losses;
  if (played <= 0) return "—";
  return `${Math.round((state.wins / played) * 100)}%`;
}

// ── storage shape validation ──────────────────────────────────────────────

/**
 * Read a rank file back out of player storage. Tolerant by design: a value
 * written by an older build, a half-written record, or a hostile one all
 * degrade to a fresh file rather than throwing inside a boot path. Numbers are
 * clamped and counts are floored at zero, so a corrupt file can only ever land
 * a player at the bottom of Bronze — never at the top.
 */
export function parseRankState(raw: unknown): RankState | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Partial<Record<keyof RankState, unknown>>;
  // A record that carries NONE of the five fields is not a half-written rank
  // file, it is somebody else's JSON under our key. Saying so (rather than
  // defaulting every field) is what lets the caller fall through to the local
  // mirror, and what makes a clobbered key a fallback instead of a reset.
  if (
    o.rating === undefined && o.matches === undefined && o.wins === undefined &&
    o.losses === undefined && o.season === undefined
  ) {
    return null;
  }
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const count = (v: unknown): number => Math.max(0, Math.floor(num(v, 0)));
  return {
    rating: clampRating(num(o.rating, START_RATING)),
    matches: count(o.matches),
    wins: count(o.wins),
    losses: count(o.losses),
    season: typeof o.season === "string" && o.season.length > 0 ? o.season : RANK_SEASON,
  };
}

export const serializeRankState = (state: RankState): string => JSON.stringify(state);

// ── the wire: what a room holds about each player ─────────────────────────

/**
 * A rating as it travels: this is the room's copy of "who is what", published
 * once per player on join. Deliberately NOT the full file — the wire carries
 * exactly the two numbers `rateMatch` reads, so nothing else can be influenced
 * by a peer. `joinToken` is present only on the joiner's own message; the room
 * keeps the token and refuses any later rating from that player (see
 * `src/rooms/HexmatchRoom.ts`).
 */
export interface RankWire {
  id: string;
  rating: number;
  matches: number;
  joinToken?: string;
}

/**
 * The room's rating board, as a peer sees it. Both clients rebuild this from
 * the welcome + `rating` messages and it is what `applyResult` is fed, so the
 * two halves of a rated match are always computed from the same inputs.
 */
export type RankBoard = Record<string, { rating: number; matches: number }>;

export function parseRankWire(raw: unknown): RankWire | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<RankWire>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  const rating = typeof o.rating === "number" && Number.isFinite(o.rating) ? o.rating : START_RATING;
  const matches = typeof o.matches === "number" && Number.isFinite(o.matches)
    ? Math.max(0, Math.floor(o.matches))
    : 0;
  const out: RankWire = { id: o.id, rating: clampRating(rating), matches };
  if (typeof o.joinToken === "string" && o.joinToken.length > 0) out.joinToken = o.joinToken;
  return out;
}

/** `{ id: { rating, matches } }` from a roster, for opponent lookups. */
export function rankBoardFrom(entries: readonly RankWire[]): RankBoard {
  const board: RankBoard = {};
  for (const entry of entries) board[entry.id] = { rating: entry.rating, matches: entry.matches };
  return board;
}

/**
 * The opponent's numbers as `applyResult` needs them. A player the room never
 * heard from (an older build, a storage failure, an AI seat) is read as a
 * fresh 1000 — the same rating this player's own first match would be worth
 * against anyone, and the least surprising default on a board that carries no
 * information. `known: false` lets the UI say the result was provisional.
 */
export function opponentFor(
  board: RankBoard,
  opponentId: string,
): RatedPlayer & { known: boolean } {
  const entry = board[opponentId];
  if (!entry) return { id: opponentId, rating: START_RATING, matches: 0, known: false };
  return { id: opponentId, rating: entry.rating, matches: entry.matches, known: true };
}

// ── the verdict a finished match produces ─────────────────────────────────

/** What a filed match means for each seat, as both clients agree on it. */
export interface RankVerdict {
  /** Which local seat won: `self` is the winner, `opponent` lost. */
  outcome: "win" | "loss";
  /** The player's rating file after the match. */
  state: RankState;
  change: RatingChange;
  opponentAfter: number;
  promoted: boolean;
  demoted: boolean;
  tierBefore: RankTier;
  tierAfter: RankTier;
  /** False when the opponent's rating was unknown to the room. */
  opponentKnown: boolean;
  /** True when the match ended by abandonment rather than by the star line. */
  forfeit: boolean;
}

/**
 * Everything the end-of-match screen needs, from the two facts it has: the
 * player's own file, and who won. Pure — the caller owns storage and the wire.
 */
export function rateOutcome(input: {
  self: { id: string; state: RankState };
  opponent: RatedPlayer & { known: boolean };
  won: boolean;
  forfeit?: boolean;
}): RankVerdict {
  const filed = applyResult(input.self.state, input.won, input.opponent, input.self);
  return {
    outcome: input.won ? "win" : "loss",
    state: filed.state,
    change: filed.change,
    opponentAfter: filed.opponentAfter,
    promoted: filed.promoted,
    demoted: filed.demoted,
    tierBefore: filed.tierBefore,
    tierAfter: filed.tierAfter,
    opponentKnown: input.opponent.known,
    forfeit: input.forfeit === true,
  };
}

/**
 * The ladder score for a rating: the leaderboard ranks HIGHEST-first, so a
 * player's rating IS their score. Exported as a function — rather than used
 * inline — so the one place that decides this is named, and so a future
 * season reset has a single seam to change.
 */
export const ladderScoreFor = (rating: number): number => clampRating(rating);
