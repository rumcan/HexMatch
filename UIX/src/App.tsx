import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ChartNoAxesColumn,
  ChevronDown,
  ChevronUp,
  Cog,
  Factory,
  Hexagon,
  Layers3,
  MapPinned,
  Pickaxe,
  Route,
  TrainFront,
  Warehouse,
  X,
} from "lucide-react";
import "./index.css";

const poster = (name: string) =>
  `https://raw.githubusercontent.com/rumcan/HexMatch/main/src/assets/poster/${name}`;

type CharacterKey = "james" | "anne";
type ProfileTab = "profile" | "history" | "rivals";
type Screen = "roster" | "title" | "game";
type GameTab = "build" | "contracts" | "market";
type ToolKey = "road" | "depot" | "rail" | "factory";

const characters = {
  james: {
    first: "JAMES",
    last: "HEXTALL",
    accent: "#ec6c10",
    image: poster("hero-james.webp"),
    thumbnail: poster("thumb-james.webp"),
    quote: ["Build it first. Build it bigger.", "Then build the road to it."],
    bio: "Founder of Hextall Freight. Came home from the war with one lorry and a plan to own every road on the island.",
    history: [
      ["1945", "THE RETURN", "One lorry, no depot, and no favors owed."],
      ["1947", "HEXTALL FREIGHT", "His first road contract changed the island."],
      ["1949", "THE RACE", "Every new mile puts a rival on notice."],
    ],
    rivalry: "He will outbuild anyone who thinks the island is already spoken for.",
  },
  anne: {
    first: "ANNE",
    last: "HEXTALL",
    accent: "#00aeb8",
    image: poster("hero-anne.webp"),
    thumbnail: poster("thumb-anne.webp"),
    quote: ["Anyone can build a factory.", "I read the ledger."],
    bio: "Runs the books and the backroom deals. Knows the price of every ton of ore on the island before the market does.",
    history: [
      ["1944", "THE LEDGER", "She learned what the numbers never said aloud."],
      ["1947", "A QUIET PARTNER", "Every deal Hextall made crossed her desk."],
      ["1949", "HER MOVE", "The island's markets are hers to read."],
    ],
    rivalry: "The rival can keep the factory. Anne already knows where its cargo is going.",
  },
} as const;

const tools = {
  road: { name: "Road", cost: "2 WOOD", description: "Connect a depot to the routes that move its freight.", icon: Route },
  depot: { name: "Depot", cost: "8 WOOD + 4 ORE", description: "Collect cargo from the industries within reach.", icon: Warehouse },
  rail: { name: "Railway", cost: "6 ORE", description: "Move heavier loads across the island faster.", icon: TrainFront },
  factory: { name: "Factory", cost: "12 ORE + 8 WOOD", description: "Turn raw materials into the next rung of your empire.", icon: Factory },
} as const;

const scenes: { id: Screen; number: string; label: string }[] = [
  { id: "roster", number: "01", label: "CHARACTERS" },
  { id: "title", number: "02", label: "TITLE SCREEN" },
  { id: "game", number: "03", label: "GAME HUD" },
];

const screenMotion = {
  initial: { opacity: 0, y: 14, scale: 0.992 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 1.006 },
  transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <img
      className={`brand-logo ${className}`}
      src={poster("logo.webp")}
      alt="HexMatch Industries"
      draggable={false}
    />
  );
}

function RosterScreen({
  character,
  setCharacter,
  tab,
  setTab,
  onSelect,
  onTitle,
}: {
  character: CharacterKey;
  setCharacter: (value: CharacterKey) => void;
  tab: ProfileTab;
  setTab: (value: ProfileTab) => void;
  onSelect: () => void;
  onTitle: () => void;
}) {
  const selected = characters[character];
  const flipCharacter = () => {
    setCharacter(character === "james" ? "anne" : "james");
    setTab("profile");
  };

  return (
    <motion.main
      {...screenMotion}
      className="showcase roster-frame"
      style={{ "--accent": selected.accent } as CSSProperties}
      aria-label="Choose a HexMatch Industries manager"
    >
      <aside className="roster-sidebar">
        <button className="logo-button" onClick={onTitle} aria-label="View the title screen">
          <BrandLogo />
        </button>

        <div className="roster-navigation">
          <div className="scroll-guide" aria-label="Use arrows to switch managers">
            <button onClick={flipCharacter} aria-label="Previous manager"><ChevronUp size={18} /></button>
            <span className="scroll-line" />
            <span className="scroll-word">SCROLL</span>
            <span className="scroll-line" />
            <button onClick={flipCharacter} aria-label="Next manager"><ChevronDown size={18} /></button>
          </div>
          <div className="portrait-list" role="group" aria-label="Managers">
            {(["james", "anne"] as const).map((key) => (
              <button
                key={key}
                className={`portrait-option ${character === key ? "is-active" : ""}`}
                onClick={() => { setCharacter(key); setTab("profile"); }}
                aria-pressed={character === key}
                aria-label={`View ${characters[key].first} ${characters[key].last}`}
                style={{ "--thumb-accent": characters[key].accent } as CSSProperties}
              >
                <img src={characters[key].thumbnail} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </div>
        <span className="roster-count">{character === "james" ? "01" : "02"} / 02</span>
      </aside>

      <div className={`portrait-stage ${character}`} aria-hidden="true">
        <AnimatePresence mode="wait">
          <motion.div
            className="portrait-art-layer"
            key={character}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.44, ease: [0.22, 1, 0.36, 1] }}
          >
            <img className="portrait-ghost" src={selected.image} alt="" draggable={false} />
            <img className="portrait-hero" src={selected.image} alt="" draggable={false} />
          </motion.div>
        </AnimatePresence>
      </div>

      <section className="profile-detail">
        <div className="profile-header">
          <nav className="profile-tabs" aria-label="Manager details">
            {(["profile", "history", "rivals"] as const).map((item, index) => (
              <div className="profile-tab-wrap" key={item}>
                {index > 0 && <span className="tab-divider" aria-hidden="true" />}
                <button
                  className={tab === item ? "active" : ""}
                  onClick={() => setTab(item)}
                  aria-current={tab === item ? "page" : undefined}
                >
                  {item}
                </button>
              </div>
            ))}
          </nav>
          <button className="select-button" onClick={onSelect}>
            SELECT <ArrowRight size={21} strokeWidth={2.4} />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {tab === "profile" ? (
            <motion.div
              key={`${character}-profile`}
              className="detail-body profile-body"
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.26 }}
            >
              <h1 className="character-name"><span>{selected.first}</span><span>{selected.last}</span></h1>
              <p className="profile-quote">"{selected.quote[0]}<br />{selected.quote[1]}"</p>
              <div className="accent-rule" />
              <p className="profile-bio">{selected.bio}</p>
            </motion.div>
          ) : tab === "history" ? (
            <motion.div
              key={`${character}-history`}
              className="detail-body editorial-body"
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.26 }}
            >
              <p className="editorial-kicker">THE HEXTALL FILES / {character === "james" ? "01" : "02"}</p>
              <h2 className="editorial-title">A LIFE IN<br />MOTION</h2>
              <div className="accent-rule" />
              <div className="history-list">
                {selected.history.map(([year, title, text]) => (
                  <div className="history-row" key={year}>
                    <span>{year}</span>
                    <div><strong>{title}</strong><p>{text}</p></div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`${character}-rivals`}
              className="detail-body editorial-body"
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.26 }}
            >
              <p className="editorial-kicker">THE ISLAND HAS TWO SIDES</p>
              <h2 className="editorial-title">KNOW YOUR<br />RIVALS</h2>
              <p className="profile-quote rival-quote">"{selected.rivalry}"</p>
              <div className="accent-rule" />
              <div className="rival-line"><span>01 / THE FOUNDRY SYNDICATE</span><strong>Own the roads.</strong></div>
              <div className="rival-line"><span>02 / YOUR NEXT MOVE</span><strong>Build something bigger.</strong></div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="profile-icons" aria-label="Manager specialties">
          <span title="Industry"><Cog size={28} strokeWidth={1.8} /></span>
          <i aria-hidden="true" />
          <span title="Logistics"><Layers3 size={29} strokeWidth={1.8} /></span>
          <span title="Enterprise"><ChartNoAxesColumn size={28} strokeWidth={1.9} /></span>
          <i aria-hidden="true" />
          <span className="hex-specialty" title="Selected manager"><Hexagon size={47} strokeWidth={1.8} /></span>
        </div>
      </section>
    </motion.main>
  );
}

function TitleScreen({ onRoster, onPlay }: { onRoster: () => void; onPlay: () => void }) {
  return (
    <motion.main {...screenMotion} className="showcase title-frame" aria-label="HexMatch Industries title screen">
      <div className="title-keyart" />
      <div className="title-topline"><span>1949 / A NEW EMPIRE BEGINS</span><span>THE ISLAND IS YOURS TO BUILD</span></div>
      <div className="title-actions">
        <button className="title-secondary" onClick={onRoster}><ArrowLeft size={18} /> CHOOSE MANAGER</button>
        <button className="title-primary" onClick={onPlay}>ENTER THE ISLAND <ArrowRight size={21} /></button>
      </div>
    </motion.main>
  );
}

function GameScreen({
  character,
  onBack,
}: {
  character: CharacterKey;
  onBack: () => void;
}) {
  const [tool, setTool] = useState<ToolKey>("road");
  const [tab, setTab] = useState<GameTab>("build");
  const [placed, setPlaced] = useState(0);
  const [notice, setNotice] = useState("");
  const [site, setSite] = useState("HEXTALL DEPOT");

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const ToolIcon = tools[tool].icon;
  return (
    <motion.main {...screenMotion} className="showcase game-frame" aria-label="HexMatch Industries game interface demo">
      <div className="game-map" />
      <header className="game-topbar">
        <button className="game-back" onClick={onBack} aria-label="Back to manager selection"><ArrowLeft size={19} /></button>
        <div className="game-brand">HEX<span>MATCH</span><em>Industries</em></div>
        <div className="game-resources" aria-label="Example resources">
          <span><b>WOOD</b> 48</span><span><b>ORE</b> 32</span><span><b>COIN</b> 1,240</span>
        </div>
        <div className="game-era">ISLAND 01 <span>/</span> 1949</div>
        <img className="game-avatar" src={characters[character].thumbnail} alt={`${characters[character].first}'s portrait`} />
      </header>

      <nav className="game-rail" aria-label="Build tools">
        <span className="rail-heading">BUILD</span>
        {(Object.keys(tools) as ToolKey[]).map((key) => {
          const Icon = tools[key].icon;
          return (
            <button
              key={key}
              className={tool === key && tab === "build" ? "selected" : ""}
              onClick={() => { setTool(key); setTab("build"); }}
              aria-pressed={tool === key && tab === "build"}
              title={`Build ${tools[key].name}`}
            >
              <Icon size={23} strokeWidth={1.8} />
              <small>{tools[key].name}</small>
            </button>
          );
        })}
      </nav>

      <div className="map-marker mine" aria-hidden="true"><Pickaxe size={15} /> ORE MINE</div>
      <button className="map-marker depot" onClick={() => { setSite("HEXTALL DEPOT"); setNotice("Hextall Depot: routes connected."); }}><Warehouse size={15} /> HEXTALL DEPOT</button>
      <button className="map-marker town" onClick={() => { setSite("PORT HARBOR"); setNotice("Port Harbor: waiting for freight."); }}><MapPinned size={15} /> PORT HARBOR</button>
      <span className="map-hex one" aria-hidden="true" /><span className="map-hex two" aria-hidden="true" />

      <div className="game-minimap" aria-label="Map preview"><img src="/images/island-map.jpg" alt="" /><span /></div>
      <div className="game-location"><span className="location-line" /> {site} <span className="location-coord">43 / 18</span></div>

      <section className="game-drawer" aria-label="Game actions">
        <div className="drawer-content">
          {tab === "build" ? (
            <div className="drawer-build">
              <div className="drawer-symbol"><ToolIcon size={32} strokeWidth={1.6} /></div>
              <div className="drawer-copy"><span className="drawer-eyebrow">CONSTRUCTION / {tools[tool].cost}</span><h2>{tools[tool].name}</h2><p>{tools[tool].description}</p></div>
              <button className="drawer-action" onClick={() => { setPlaced((count) => count + 1); setNotice(`${tools[tool].name} placed. Your network is growing.`); }}>PLACE <ArrowRight size={18} /></button>
            </div>
          ) : tab === "contracts" ? (
            <div className="drawer-build">
              <div className="drawer-symbol"><Warehouse size={32} strokeWidth={1.6} /></div>
              <div className="drawer-copy"><span className="drawer-eyebrow">ACTIVE CONTRACT / PORT HARBOR</span><h2>Move the ore</h2><p>Deliver cargo to the town and put the next road on the map.</p></div>
              <button className="drawer-action" onClick={() => setNotice("Contract pinned: deliver ore to Port Harbor.")}>PIN <ArrowRight size={18} /></button>
            </div>
          ) : (
            <div className="drawer-build">
              <div className="drawer-symbol"><ChartNoAxesColumn size={32} strokeWidth={1.6} /></div>
              <div className="drawer-copy"><span className="drawer-eyebrow">MARKET REPORT / 1949</span><h2>Freight is rising</h2><p>Good roads turn cargo into opportunity. Keep an eye on the ledger.</p></div>
              <button className="drawer-action" onClick={() => setNotice("Market report filed in the ledger.")}>FILE <ArrowRight size={18} /></button>
            </div>
          )}
        </div>
        <nav className="drawer-tabs" aria-label="Game panels">
          {(["build", "contracts", "market"] as const).map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
          ))}
          <span className="placed-count">{placed > 0 ? `${placed} PLACED` : "DEMO / INTERACTIVE"}</span>
        </nav>
      </section>
      <AnimatePresence>{notice && <motion.div className="game-notice" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>{notice}</motion.div>}</AnimatePresence>
    </motion.main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("roster");
  const [character, setCharacter] = useState<CharacterKey>("james");
  const [profileTab, setProfileTab] = useState<ProfileTab>("profile");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setShowHelp(false); return; }
      if (screen === "roster" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        setCharacter((current) => current === "james" ? "anne" : "james");
        setProfileTab("profile");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [screen]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="app-shell">
      <div className="scenery" aria-hidden="true" />
      <header className="preview-header">
        <div className="preview-identity"><Hexagon size={18} strokeWidth={1.5} /><span>HEX<span className="identity-slash">/</span> UI CONCEPT</span><span className="version">V.01</span></div>
        <nav className="scene-switcher" aria-label="Preview screens">
          {scenes.map((scene) => (
            <button key={scene.id} className={screen === scene.id ? "active" : ""} onClick={() => setScreen(scene.id)}>
              <span>{scene.number}</span> {scene.label}
            </button>
          ))}
        </nav>
        <div className="preview-actions">
          <button className="help-trigger" onClick={() => setShowHelp(true)} aria-label="About this demo">?</button>
          <a className="patch-download" href="/hexmatch-industries.patch" download="hexmatch-industries.patch"><span>DOWNLOAD PATCH</span><ArrowDownToLine size={17} strokeWidth={2} /></a>
        </div>
      </header>

      <div className="preview-stage">
        <AnimatePresence mode="wait">
          {screen === "roster" ? (
            <RosterScreen
              key="roster" character={character} setCharacter={setCharacter}
              tab={profileTab} setTab={setProfileTab}
              onSelect={() => setScreen("game")} onTitle={() => setScreen("title")}
            />
          ) : screen === "title" ? (
            <TitleScreen key="title" onRoster={() => setScreen("roster")} onPlay={() => setScreen("game")} />
          ) : (
            <GameScreen key="game" character={character} onBack={() => setScreen("roster")} />
          )}
        </AnimatePresence>
      </div>

      <footer className="preview-footer"><span>HEXMatch Industries / visual redesign preview</span><span>Art from the HexMatch repository. Game HUD is an interactive mockup.</span></footer>

      <AnimatePresence>
        {showHelp && (
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowHelp(false)}>
            <motion.div className="help-dialog" role="dialog" aria-modal="true" aria-label="About this UI preview" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} onClick={(event) => event.stopPropagation()}>
              <button className="dialog-close" onClick={() => setShowHelp(false)} aria-label="Close"><X size={22} /></button>
              <BrandLogo />
              <p className="dialog-kicker">A NEW LOOK FOR THE ISLAND</p>
              <h2>Built for the<br />big picture.</h2>
              <p>Explore the character selector, title art, and a small HUD mockup. The downloadable patch applies the same color, type, surfaces, and poster artwork to the real HexMatch UI without changing its game rules.</p>
              <code className="apply-command">git apply hexmatch-industries.patch</code>
              <a href="/hexmatch-industries.patch" download="hexmatch-industries.patch" className="dialog-download">DOWNLOAD THE PATCH <ArrowDownToLine size={18} /></a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}