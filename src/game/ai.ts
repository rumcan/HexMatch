import { COSTS, SABOTAGE, ResKey, RES_KEYS, choice, randInt, rand } from "./config";
import { G, Player, Offer, bus } from "./state";
import { playerResources } from "./hexmap";
import {
  doRoad, doSettlement, doCity, canAfford, gainRes, placeBandit, applySabotage,
  findLegalSettlement, findLegalRoad, tileVictimHarvests,
} from "./actions";
import { acceptOffer, postOffer, liveOffers } from "./trade";

const SAB_WEIGHTS: Record<string, number> = { harden: 5, block: 1, fog: 2, bandit: 3 };

export function aiTick(now: number, dt: number) {
  for (const p of G.players as Player[]) {
    if (p.human) continue;
    const slow = p.slowedUntil > now ? 0.35 : 1;

    p.nextIncome -= dt * slow;
    p.nextBuild -= dt * slow;
    p.nextTrade -= dt;
    p.nextEvil -= dt;

    if (p.nextIncome <= 0) { aiIncome(p, now); p.nextIncome = 7000 - p.skill * 2200 + rand(4500); }
    if (p.nextBuild <= 0) { aiBuild(p); p.nextBuild = 9000 + rand(7000); }
    if (p.nextTrade <= 0) { aiTrade(p); p.nextTrade = 15000 + rand(15000); }
    if (p.nextEvil <= 0) { p.nextEvil = aiEvil(p); }
  }
}

function aiIncome(p: Player, now: number) {
  const pool = playerResources(G.map, p, now);
  const keys = Object.keys(pool) as ResKey[];
  if (!keys.length) return;
  const picks = 1 + (rand() < p.skill * 0.55 ? 1 : 0);
  for (let i = 0; i < picks; i++) {
    const res = choice(keys);
    if (rand() < 0.55 + p.skill * 0.3) gainRes(p, res, pool[res] as number);
  }
  if (rand() < 0.16 + p.skill * 0.12) gainRes(p, "gold", 1);
}

function aiBuild(p: Player) {
  // city
  if (p.settlements.length && canAfford(p, COSTS.city.cost)) {
    if (doCity(p, choice(p.settlements))) { bus.emit("log", { who: p.i, text: `${p.name} raised a Foundry.` }); return; }
  }
  if (canAfford(p, COSTS.settlement.cost)) {
    const v = findLegalSettlement(p, false);
    if (v >= 0 && doSettlement(p, v)) { bus.emit("log", { who: p.i, text: `${p.name} built a Factory.` }); return; }
  }
  if (rand() < 0.7 && p.roads.length < 12 && canAfford(p, COSTS.road.cost)) {
    const e = findLegalRoad(p);
    if (e >= 0) doRoad(p, e);
  }
}

function aiTrade(p: Player) {
  // try accept an existing offer that helps
  if (rand() < 0.75) {
    for (const o of G.offers as Offer[]) {
      if (o.from === p.i) continue;
      if (p.res[o.want] >= o.wantN && p.res[o.want] > o.wantN) {
        if (acceptOffer(p, o.id)) return;
      }
    }
  }
  // post surplus vs scarcest
  if (liveOffers(p).length >= 3) return;
  let surplus: ResKey | null = null, sMax = 2;
  let scarce: ResKey | null = null, sMin = Infinity;
  for (const k of RES_KEYS) {
    if (k === "gold") continue;
    if (p.res[k] > sMax) { sMax = p.res[k]; surplus = k; }
    if (p.res[k] < sMin) { sMin = p.res[k]; scarce = k; }
  }
  if (surplus && scarce && surplus !== scarce && p.res[surplus] >= 3) {
    postOffer(p, surplus, 1 + randInt(2), scarce, 1 + randInt(2));
  }
}

function aiEvil(p: Player): number {
  // choose ability among affordable, weighted
  const opts = Object.keys(SABOTAGE).filter((k) => p.res.gold >= SABOTAGE[k].gold);
  if (!opts.length) return 14000 + rand(10000);
  const bag: string[] = [];
  opts.forEach((k) => { for (let i = 0; i < SAB_WEIGHTS[k]; i++) bag.push(k); });
  const key = choice(bag);
  // victim: 60% human else leader
  let victim: Player;
  if (rand() < 0.6) victim = G.players[0];
  else victim = [...G.players].sort((a, b) => b.vp - a.vp)[0];
  if (victim.i === p.i) victim = G.players[0];

  // security blocks Blockade & Smog aimed at the victim
  if ((key === "bandit" || key === "fog") && victim.securedUntil > performance.now()) {
    if (victim.human) bus.emit("toast", { text: `Your Security Forces repelled ${p.name}'s ${SABOTAGE[key].name}!`, kind: "success" });
    return 12000 + rand(10000);
  }
  if (key === "bandit") {
    const tile = tileVictimHarvests(victim, p);
    if (tile < 0) return 4000;
    placeBandit(p, tile);
    if (victim.human) bus.emit("toast", { text: `${p.name} set a Blockade on your district!`, kind: "danger" });
    bus.emit("log", { who: p.i, text: `${p.name} set a Blockade.` });
  } else {
    if (!applySabotage(p, key, victim)) return 10000 + rand(8000);
    if (victim.human) bus.emit("toast", { text: `${p.name} unleashed ${SABOTAGE[key].name} on your quarry!`, kind: "danger" });
    bus.emit("log", { who: p.i, text: `${p.name} used ${SABOTAGE[key].name} on ${victim.name}.` });
  }
  return 32000 + rand(24000);
}
