import { ResKey } from "./config";

// ── Event bus ──
class Bus {
  private t = new EventTarget();
  on(name: string, fn: (d: any) => void) {
    const h = (e: Event) => fn((e as CustomEvent).detail);
    this.t.addEventListener(name, h as EventListener);
    return () => this.t.removeEventListener(name, h as EventListener);
  }
  emit(name: string, d?: any) {
    this.t.dispatchEvent(new CustomEvent(name, { detail: d }));
  }
}
export const bus = new Bus();

export interface Player {
  i: number;
  name: string;
  human: boolean;
  color: string;
  res: Record<ResKey, number>;
  settlements: number[];
  cities: number[];
  roads: number[];
  capital: number;            // vertex id of the main city (network root)
  tollAccess: Set<number>;    // owner indices whose rails you've paid to use
  vp: number;
  skill: number;
  nextIncome: number;
  nextBuild: number;
  nextTrade: number;
  nextEvil: number;
  slowedUntil: number;
  securedUntil: number;       // immune to Blockade & Smog Cloud until this time
  lastGain: Partial<Record<ResKey, number>>;
}

export function makePlayer(i: number, name: string, human: boolean, color: string): Player {
  return {
    i, name, human, color,
    // you start with nothing but your headquarters — every good must be mined
    res: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, gold: 0 },
    settlements: [], cities: [], roads: [],
    capital: -1, tollAccess: new Set<number>(),
    vp: 0,
    skill: human ? 1 : 0.55 + Math.random() * 0.35,
    nextIncome: 5000 + Math.random() * 4000,
    nextBuild: 10000 + Math.random() * 6000,
    nextTrade: 12000 + Math.random() * 15000,
    nextEvil: 45000 + Math.random() * 30000,
    slowedUntil: 0,
    securedUntil: 0,
    lastGain: {},
  };
}

export interface Offer {
  id: number;
  from: number;
  give: ResKey; giveN: number;
  want: ResKey; wantN: number;
  born: number;
}

export const G: any = {
  players: [] as Player[],
  map: null as any,
  board: null as any,
  view: null as any,
  offers: [] as Offer[],
  offerSeq: 1,
  setupPhase: true,
  buildMode: null as null | string,
  pendingSabotage: null as null | string,
  running: false,
  won: false,
  upgradeTimer: 0,
};

export const human = () => G.players[0] as Player;