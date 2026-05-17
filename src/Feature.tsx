import { useEffect, useRef, useState } from "react";
import {
  MeshNameInput,
  commit,
  randomSalt,
  verifyReveal,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };

type Stroke = { peerId: string; color: string; points: number[] };

const NAME_KEY = (prefix: string) => `${prefix}:displayName`;
const COLORS = ["#f43f5e", "#38bdf8", "#a3e635", "#fbbf24", "#a855f7", "#ffffff"];
const WORDS = [
  "elephant",
  "rocket",
  "pizza",
  "lighthouse",
  "cactus",
  "umbrella",
  "octopus",
  "sandwich",
  "guitar",
  "robot",
  "volcano",
  "bicycle",
];

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="pic-screen">
        <h1>pictionary</h1>
        <p className="pic-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [color, setColor] = useState(COLORS[0]!);
  const [guessDraft, setGuessDraft] = useState("");
  const [secretWord, setSecretWord] = useState<string | null>(null);
  const [salt, setSalt] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);
  const [, rerender] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<number[] | null>(null);

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);

  useEffect(() => {
    const strokes = room.doc.getArray<Stroke>("strokes");
    const meta = room.doc.getMap<string>("meta");
    const guesses = room.doc.getMap<{ name: string; text: string }>("guesses");
    const onChange = () => rerender((n) => n + 1);
    strokes.observe(onChange);
    meta.observe(onChange);
    guesses.observe(onChange);
    return () => {
      strokes.unobserve(onChange);
      meta.unobserve(onChange);
      guesses.unobserve(onChange);
    };
  }, [room]);

  const strokes = room.doc.getArray<Stroke>("strokes");
  const meta = room.doc.getMap<string>("meta");
  const guesses = room.doc.getMap<{ name: string; text: string }>("guesses");
  const drawerId = meta.get("drawerId");
  const wordCommit = meta.get("wordCommit");
  const revealedSalt = meta.get("revealedSalt");
  const revealedWord = meta.get("revealedWord");
  const phase = (meta.get("phase") as "lobby" | "drawing" | "revealed") ?? "lobby";

  const isDrawer = drawerId === room.peerId;

  // Render strokes on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0e1117";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    strokes.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      const pts = s.points;
      if (pts.length >= 2) {
        ctx.moveTo(pts[0]!, pts[1]!);
        for (let i = 2; i < pts.length; i += 2) {
          ctx.lineTo(pts[i]!, pts[i + 1]!);
        }
      }
      ctx.stroke();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, strokes.length, phase]);

  const claimDrawer = async () => {
    if (drawerId && drawerId !== room.peerId) return;
    if (!name.trim()) return;
    const wordIdx = Math.floor(Math.random() * WORDS.length);
    const word = WORDS[wordIdx]!;
    const s = randomSalt();
    const c = await commit(word, s);
    setSecretWord(word);
    setSalt(s);
    room.doc.transact(() => {
      meta.set("drawerId", room.peerId);
      meta.set("drawerName", name.trim());
      meta.set("wordCommit", c.hash);
      meta.set("phase", "drawing");
      meta.delete("revealedSalt");
      meta.delete("revealedWord");
      strokes.delete(0, strokes.length);
      guesses.forEach((_v, k) => guesses.delete(k));
    });
  };

  const endRound = () => {
    if (!isDrawer || !secretWord || !salt) return;
    room.doc.transact(() => {
      meta.set("revealedSalt", salt);
      meta.set("revealedWord", secretWord);
      meta.set("phase", "revealed");
    });
  };

  // Anyone can verify after reveal (useful demo)
  useEffect(() => {
    if (phase !== "revealed" || !wordCommit || !revealedSalt || !revealedWord) {
      setVerifyResult(null);
      return;
    }
    verifyReveal(wordCommit, { salt: revealedSalt, payload: revealedWord }).then(setVerifyResult);
  }, [phase, wordCommit, revealedSalt, revealedWord]);

  const newRound = () => {
    setSecretWord(null);
    setSalt(null);
    setVerifyResult(null);
    room.doc.transact(() => {
      meta.delete("drawerId");
      meta.delete("drawerName");
      meta.delete("wordCommit");
      meta.delete("revealedSalt");
      meta.delete("revealedWord");
      meta.set("phase", "lobby");
      strokes.delete(0, strokes.length);
      guesses.forEach((_v, k) => guesses.delete(k));
    });
  };

  const submitGuess = (e: React.FormEvent) => {
    e.preventDefault();
    const t = guessDraft.trim();
    if (!name.trim() || !t || isDrawer) return;
    guesses.set(room.peerId, { name: name.trim(), text: t });
    setGuessDraft("");
  };

  // Pointer handling
  const getPoint = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    return [x, y];
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || phase !== "drawing") return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drawingRef.current = true;
    const [x, y] = getPoint(ev);
    currentStrokeRef.current = [x!, y!];
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentStrokeRef.current) return;
    const [x, y] = getPoint(ev);
    currentStrokeRef.current.push(x!, y!);
    // local draw for snappy feedback
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    const len = currentStrokeRef.current.length;
    ctx.moveTo(currentStrokeRef.current[len - 4]!, currentStrokeRef.current[len - 3]!);
    ctx.lineTo(x!, y!);
    ctx.stroke();
  };

  const onPointerUp = () => {
    if (!drawingRef.current || !currentStrokeRef.current) {
      drawingRef.current = false;
      currentStrokeRef.current = null;
      return;
    }
    if (currentStrokeRef.current.length >= 4) {
      strokes.push([{ peerId: room.peerId, color, points: currentStrokeRef.current.slice() }]);
    }
    drawingRef.current = false;
    currentStrokeRef.current = null;
  };

  const guessList: Array<{ name: string; text: string; peerId: string }> = [];
  guesses.forEach((v, k) => guessList.push({ ...v, peerId: k }));

  return (
    <div className="pic-screen">
      <header className="pic-header">
        <h1>pictionary</h1>
        <p className="pic-status">
          phase: {phase}
          {drawerId && ` · drawer: ${meta.get("drawerName") ?? "?"}${isDrawer ? " (you)" : ""}`}
          {" · "}
          {room.peerCount + 1} present
        </p>
      </header>

      <MeshNameInput
        className="pic-name"
        value={name}
        onChange={setName}
        placeholder="your name"
        maxLength={48}
      />

      {phase === "lobby" && (
        <div className="pic-lobby">
          <p>no active drawer. pick a word and start drawing.</p>
          <button type="button" className="pic-claim" onClick={claimDrawer} disabled={!name.trim()}>
            🎨 I'll draw
          </button>
        </div>
      )}

      {phase === "drawing" && isDrawer && secretWord && (
        <div className="pic-word">
          your word: <strong>{secretWord}</strong> (only you can see this)
        </div>
      )}
      {phase === "drawing" && !isDrawer && (
        <div className="pic-word pic-word-locked">
          🔒 word locked by drawer · commit:{" "}
          <code>{wordCommit ? wordCommit.slice(0, 12) + "…" : "?"}</code>
        </div>
      )}

      <div className="pic-tools">
        {isDrawer &&
          COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`pic-color ${c === color ? "is-active" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`color ${c}`}
            />
          ))}
        {isDrawer && phase === "drawing" && (
          <button type="button" className="pic-end" onClick={endRound}>
            end & reveal
          </button>
        )}
      </div>

      <canvas
        ref={canvasRef}
        width={520}
        height={360}
        className="pic-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {phase === "revealed" && (
        <div className="pic-reveal">
          <p>
            the word was: <strong>{revealedWord}</strong>
          </p>
          {verifyResult !== null && (
            <p className={`pic-verify ${verifyResult ? "is-ok" : "is-bad"}`}>
              commit-reveal verify: {verifyResult ? "✓ matches commit" : "✗ tampered"}
            </p>
          )}
          <button type="button" className="pic-newround" onClick={newRound}>
            new round
          </button>
        </div>
      )}

      {!isDrawer && phase === "drawing" && (
        <form className="pic-guess" onSubmit={submitGuess}>
          <input
            value={guessDraft}
            onChange={(e) => setGuessDraft(e.target.value)}
            placeholder="your guess"
            maxLength={40}
            aria-label="guess"
          />
          <button type="submit" disabled={!name.trim() || !guessDraft.trim()}>
            send
          </button>
        </form>
      )}

      <section className="pic-guesses">
        <h2 className="pic-section-title">guesses</h2>
        {guessList.length === 0 ? (
          <p className="pic-empty">no guesses yet</p>
        ) : (
          <ul>
            {guessList.map((g) => {
              const correct =
                revealedWord && g.text.trim().toLowerCase() === revealedWord.toLowerCase();
              return (
                <li key={g.peerId} className={correct ? "is-correct" : ""}>
                  <strong>{g.name}:</strong> {g.text}
                  {correct && " 🎉"}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
