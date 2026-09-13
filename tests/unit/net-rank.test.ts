// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — the rating arithmetic, the tiers, and the files they write.
//
// `src/net/rating.ts` is pure on purpose: every claim the issue makes ("rises
// when they win, falls when they lose, weighted by the opponent's rating",
// "K-factor higher for new players", "a badge per tier") is a number that can
// be checked here without a room, a socket or a browser.
//
// The badge contract is checked too — the tier table, the tool's tier table and
// the PNGs on disk have to agree, because the failure mode is a blank square in
// the lobby rather than an exception.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  K_ESTABLISHED,
  K_PROVISIONAL,
  PROVISIONAL_MATCHES,
  RANK_TIERS,
  RATING_FLOOR,
  RANK_SEASON,
  START_RATING,
  UNRANKED_KEY,
  advanceRating,
  applyResult,
  clampRating,
  expectedScore,
  fmtRating,
  fmtRatingDelta,
  freshRankState,
  kFactor,
  ladderScoreFor,
  opponentFor,
  parseRankState,
  rankBoardFrom,
  rankKeyOf,
  rankLabelOf,
  rankOf,
  rankSummary,
  rateMatch,
  searchBucket,
  rateOutcome,
  serializeRankState,
  tierProgress,
  winRate,
  type RankState,
} from "../../src/net/rating";
import { RANK_BADGE_KEYS, badgeUrlFor } from "../../src/ui/rank-badge";

const ROOT = join(__dirname, "..", "..");

describe("RANK-01 the Elo number", () => {
  it("starts everyone at 1000, in Bronze, with no badge until the first rated match", () => {
    const fresh = freshRankState();
    expect(fresh.rating).toBe(START_RATING);
    expect(fresh.matches).toBe(0);
    // 1000 is inside Bronze's band: the ladder starts at the bottom, and the
    // first few wins are the promotion.
    expect(rankOf(START_RATING).key).toBe("bronze");
    // …but the BADGE is unranked until a match has actually been filed: a
    // player who has never played should not be shown a rank they earned
    // nothing for.
    expect(rankKeyOf(fresh)).toBe(UNRANKED_KEY);
    expect(rankLabelOf(fresh)).toBe("Unranked");
  });

  it("gives the lower-rated player more for a win than the higher-rated one", () => {
    const even = rateMatch({ id: "a", rating: 1000, matches: 0 }, { id: "b", rating: 1000, matches: 0 });
    expect(even.winner.delta).toBeGreaterThan(0);
    expect(even.loser.delta).toBeLessThan(0);
    // Zero-sum in magnitude when both are provisional: one K, one expectation.
    expect(even.winner.delta).toBe(-even.loser.delta);

    // `upset` is the 900 beating the 1300 (`loser` is therefore the FAVOURITE),
    // `routine` is the favourite winning (`loser` is the underdog).
    const upset = rateMatch({ id: "a", rating: 900, matches: 10 }, { id: "b", rating: 1300, matches: 10 });
    const routine = rateMatch({ id: "a", rating: 1300, matches: 10 }, { id: "b", rating: 900, matches: 10 });
    expect(upset.winner.delta).toBeGreaterThan(routine.winner.delta);
    // …and the favourite who loses pays far more than an underdog who loses.
    expect(upset.loser.delta).toBeLessThan(routine.loser.delta);
  });

  it("moves a provisional player faster than an established one", () => {
    expect(kFactor(0)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_MATCHES - 1)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_MATCHES)).toBe(K_ESTABLISHED);
    expect(K_PROVISIONAL).toBeGreaterThan(K_ESTABLISHED);

    const newPlayer = applyResult(freshRankState(), true, { id: "b", rating: 1000, matches: 40 }, { id: "a" });
    const veteran: RankState = { ...freshRankState(), rating: 1000, matches: 40 };
    const oldPlayer = applyResult(veteran, true, { id: "b", rating: 1000, matches: 40 }, { id: "a" });
    expect(newPlayer.change.delta).toBeGreaterThan(oldPlayer.change.delta);
  });

  it("never lets a rating below the floor, however long the losing run", () => {
    // Losing to somebody at your own level, which is what actually drains a
    // rating: Elo has the underdog losing to a giant pay almost nothing, so a
    // floor test that fed the player to a 2000-rated opponent would never
    // reach it (and would be testing the wrong belief).
    let state: RankState = { ...freshRankState(), rating: RATING_FLOOR + 2, matches: 0 };
    for (let i = 0; i < 40; i++) {
      state = applyResult(state, false, { id: "b", rating: state.rating, matches: 50 }, { id: "a" }).state;
    }
    expect(state.rating).toBe(RATING_FLOOR);
    expect(clampRating(-500)).toBe(RATING_FLOOR);
    expect(clampRating(Number.NaN)).toBe(START_RATING);
    expect(ladderScoreFor(Number.POSITIVE_INFINITY)).toBe(START_RATING);
  });

  it("keeps the two seats' numbers consistent with one another", () => {
    // The classic Elo bug is updating the winner first and then reading the
    // new number as the loser's opponent. `rateMatch` computes both halves
    // from the SAME pre-match pair, so a rating is never compared with itself.
    const a = { id: "a", rating: 1180, matches: 3 };
    const b = { id: "b", rating: 1420, matches: 25 };
    const result = rateMatch(a, b);
    const expectation = expectedScore(a.rating, b.rating);
    expect(result.winner.after).toBe(clampRating(a.rating + K_PROVISIONAL * (1 - expectation)));
    expect(result.loser.after).toBe(clampRating(b.rating - K_ESTABLISHED * (1 - expectation)));
  });

  it("counts wins, losses and the matches that make a player established", () => {
    let state = freshRankState();
    state = applyResult(state, true, { id: "b", rating: 1000, matches: 0 }, { id: "a" }).state;
    state = applyResult(state, false, { id: "b", rating: 1000, matches: 0 }, { id: "a" }).state;
    expect(state.matches).toBe(2);
    expect(state.wins).toBe(1);
    expect(state.losses).toBe(1);
    expect(state.season).toBe(RANK_SEASON);
    expect(winRate(state)).toBe("50%");
    expect(winRate(freshRankState())).toBe("—");
  });

  it("reports promotions and demotions only when the BAND changes", () => {
    const silver: RankState = { ...freshRankState(), rating: 1095, matches: 4, wins: 3, losses: 1 };
    // A win that crosses 1100 is a promotion; one that does not is just a win.
    const promotion = applyResult(silver, true, { id: "b", rating: 1000, matches: 0 }, { id: "a" });
    expect(promotion.promoted).toBe(true);
    expect(promotion.tierAfter.key).toBe("silver");
    expect(promotion.tierBefore.key).toBe("bronze");

    const staysBronze = applyResult({ ...silver, rating: 1010 }, true, { id: "b", rating: 1000, matches: 0 }, { id: "a" });
    expect(staysBronze.promoted).toBe(false);

    // An even match at the very bottom of a band: the loss that relegates.
    const high: RankState = { ...freshRankState(), rating: 1102, matches: 30, wins: 20, losses: 10 };
    const drops = applyResult(high, false, { id: "b", rating: 1102, matches: 30 }, { id: "a" });
    expect(drops.demoted).toBe(true);
    expect(drops.tierAfter.key).toBe("bronze");
  });

  it("prints the rating and the delta the way the HUD does", () => {
    expect(fmtRating(1042.6)).toBe("1043");
    expect(fmtRatingDelta(18)).toBe("+18");
    // The typographic minus, matching `vpDeltaText` and the rest of the HUD.
    expect(fmtRatingDelta(-14)).toBe("−14");
    expect(fmtRatingDelta(0)).toBe("+0");
    expect(rankSummary(freshRankState())).toBe("Unranked · placement");
    // 1240 is still Silver: Gold starts at 1250, and the bands are the table's.
    expect(rankSummary({ ...freshRankState(), rating: 1240, matches: 12 }))
      .toBe("1240 · Silver");
    expect(rankSummary({ ...freshRankState(), rating: 1030, matches: 4 }))
      .toBe("1030 · Bronze · 6 to go");
  });

  it("buckets a similar-rank search window, and treats zero as any rank", () => {
    // The pool matches criteria by equality, so a window is a bucket index.
    // Two players inside one bucket meet; a wider span moves both into a
    // coarser bucket, which is what "the window widens" means on the wire.
    expect(searchBucket(1000, 75)).toBe(13);
    expect(searchBucket(1010, 75)).toBe(13);      // same neighbourhood
    expect(searchBucket(1180, 400)).toBe(3);
    expect(searchBucket(1240, 400)).toBe(3);      // a wider window catches both
    expect(searchBucket(1000, 400)).toBe(3);
    // …and the same pair does NOT share the tightest window.
    expect(searchBucket(1180, 75)).not.toBe(searchBucket(1240, 75));
    // Any rank: no criterion at all.
    expect(searchBucket(1000, 0)).toBeNull();
    expect(searchBucket(1000, -5)).toBeNull();
    // Bucket keys stay integers (the pool accepts numbers, and this is one).
    expect(Number.isInteger(searchBucket(1234, 100)!)).toBe(true);
  });

  it("walks the tiers upward, with the top band open-ended", () => {
    expect(RANK_TIERS.map((t) => t.key)).toEqual(
      ["bronze", "silver", "gold", "platinum", "diamond", "master"],
    );
    // Bands are contiguous and ascending: no rating belongs to no tier.
    for (let i = 1; i < RANK_TIERS.length; i++) {
      expect(RANK_TIERS[i].min).toBeGreaterThan(RANK_TIERS[i - 1].min);
      expect(rankOf(RANK_TIERS[i].min).key).toBe(RANK_TIERS[i].key);
      expect(rankOf(RANK_TIERS[i].min - 1).key).toBe(RANK_TIERS[i - 1].key);
    }
    // Master has no ceiling — 4000 is still Master, not a missing tier.
    expect(rankOf(4000).key).toBe("master");

    const early = tierProgress(1125);
    expect(early.tier.key).toBe("silver");
    expect(early.next?.key).toBe("gold");
    expect(early.toNext).toBe(125);
    expect(early.fraction).toBeCloseTo((1125 - 1100) / 150, 5);
    const top = tierProgress(2400);
    expect(top.next).toBeNull();
    expect(top.fraction).toBe(1);
    expect(top.toNext).toBe(0);
  });
});

describe("RANK-01 the stored file", () => {
  it("round-trips, and refuses anything that is not one of ours", () => {
    const state: RankState = { rating: 1234, matches: 9, wins: 6, losses: 3, season: RANK_SEASON };
    expect(parseRankState(serializeRankState(state))).toEqual(state);
    for (const bad of [null, undefined, 7, "{}", "not json", "[]", '""']) {
      expect(parseRankState(bad)).toBeNull();
    }
  });

  it("clamps a hostile or half-written file instead of throwing", () => {
    // The dangerous shape: a file that claims a rating nobody earned. It is
    // clamped to a legal RATING, and every counter is floored at zero — a
    // corrupt file can land a player at the bottom, never at the top of a
    // band it did not earn.
    const parsed = parseRankState(JSON.stringify({
      rating: "99999", matches: -3, wins: null, losses: 2.7, season: 12,
    }));
    expect(parsed).toEqual({
      rating: START_RATING, matches: 0, wins: 0, losses: 2, season: RANK_SEASON,
    });
    expect(parseRankState(JSON.stringify({ rating: Number.NaN, matches: 1 }))!.rating).toBe(START_RATING);
    expect(parseRankState(JSON.stringify({ rating: 1200, matches: 4, season: "s9" }))!.season).toBe("s9");
  });

  it("advanceRating takes the NEWER file — a loss lowers the rating", () => {
    const held: RankState = { rating: 1300, matches: 20, wins: 12, losses: 8, season: RANK_SEASON };
    // The match just filed: one more match, a lower number. That is a real
    // loss, and refusing to store it would be a rating that only ever rises.
    const lost = advanceRating(held, { rating: 1292, matches: 21, wins: 12, losses: 9, season: RANK_SEASON });
    expect(lost.rating).toBe(1292);
    expect(lost.losses).toBe(9);
    // A STALE file — fewer matches — never overwrites the newer history, even
    // though this is the direction a forged result would come from.
    const stale = advanceRating(lost, { rating: 1400, matches: 19, wins: 12, losses: 7, season: RANK_SEASON });
    expect(stale).toEqual(lost);
    expect(advanceRating(null, held)).toEqual(held);
    // A season reset REPLACES: the new season's file is the truth, lower or not.
    const nextSeason = { ...held, rating: 1000, matches: 0, season: "s2" };
    expect(advanceRating(held, nextSeason)).toEqual(nextSeason);
  });
});

describe("RANK-01 the opponent's numbers", () => {
  it("reads an unpublished opponent as a fresh 1000, and says so", () => {
    const board = rankBoardFrom([
      { id: "host", rating: 1240, matches: 12 },
      { id: "guest", rating: 1080, matches: 3 },
    ]);
    expect(board.host).toEqual({ rating: 1240, matches: 12 });
    expect(opponentFor(board, "host")).toEqual({ id: "host", rating: 1240, matches: 12, known: true });
    const unknown = opponentFor(board, "somebody-else");
    expect(unknown).toEqual({ id: "somebody-else", rating: START_RATING, matches: 0, known: false });
  });

  it("produces the verdict the ending screen reads", () => {
    const me: RankState = { rating: 1200, matches: 8, wins: 5, losses: 3, season: RANK_SEASON };
    const win = rateOutcome({
      self: { id: "me", state: me },
      opponent: { id: "them", rating: 1250, matches: 20, known: true },
      won: true,
    });
    expect(win.outcome).toBe("win");
    expect(win.change.before).toBe(1200);
    expect(win.change.after).toBeGreaterThan(1200);
    expect(win.state.rating).toBe(win.change.after);
    expect(win.forfeit).toBe(false);
    expect(win.opponentKnown).toBe(true);

    const loss = rateOutcome({
      self: { id: "me", state: me },
      opponent: { id: "them", rating: 1250, matches: 20, known: true },
      won: false,
      forfeit: true,
    });
    expect(loss.outcome).toBe("loss");
    expect(loss.change.delta).toBeLessThan(0);
    expect(loss.forfeit).toBe(true);

    // An opponent the room never heard from rates the match, but the verdict
    // refuses to pretend the number is meaningful.
    const unknown = rateOutcome({
      self: { id: "me", state: me },
      opponent: { id: "them", rating: START_RATING, matches: 0, known: false },
      won: true,
    });
    expect(unknown.opponentKnown).toBe(false);
  });
});

describe("RANK-01 the badges are real, and the tiers agree with the art", () => {
  it("ships one badge per tier (plus unranked) on disk", () => {
    for (const key of RANK_BADGE_KEYS) {
      expect(existsSync(join(ROOT, "src/assets/ui/rank", `${key}.png`)), key).toBe(true);
    }
    // No orphans: a PNG with no key is a tier somebody forgot to wire up.
    expect(RANK_BADGE_KEYS).toEqual([UNRANKED_KEY, ...RANK_TIERS.map((t) => t.key)]);
  });

  it("agrees with the derive tool's own table (the art and the game cannot drift)", () => {
    const tool = readFileSync(join(ROOT, "tools/make-rank-badges.mjs"), "utf8");
    for (const tier of [{ key: UNRANKED_KEY }, ...RANK_TIERS]) {
      expect(tool, `tools/make-rank-badges.mjs has no ${tier.key} tier`).toContain(`key: "${tier.key}"`);
    }
  });

  it("falls back to a medal for a tier key this build does not know", () => {
    expect(badgeUrlFor("gold")).toBe(badgeUrlFor("gold"));
    expect(badgeUrlFor("platinum-delta")).toBe(badgeUrlFor(UNRANKED_KEY));
  });
});
