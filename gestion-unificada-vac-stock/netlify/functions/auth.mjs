import { getStore } from "@netlify/blobs";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const STORE = "gestion-unificada";
const USERS_KEY = "auth/users";
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

const defaultUsers = {
  VISCOMI: { passHash: null, rol: "admin", sessionVersion: 1 },
  FLORES: { passHash: null, rol: "operativo", sessionVersion: 1 },
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

function normalizeUsers(x) {
  const u = x && typeof x === "object" ? x : {};
  return {
    VISCOMI: {
      passHash: u.VISCOMI?.passHash ?? null,
      rol: "admin",
      sessionVersion: Number(u.VISCOMI?.sessionVersion || 1)
    },
    FLORES: {
      passHash: u.FLORES?.passHash ?? null,
      rol: "operativo",
      sessionVersion: Number(u.FLORES?.sessionVersion || 1)
    }
  };
}

async function getUsers() {
  const store = getStore(STORE);
  const saved = await store.get(USERS_KEY, { type: "json", consistency: "strong" });
  if (!saved) {
    const users = structuredClone(defaultUsers);
    await store.setJSON(USERS_KEY, users);
    return users;
  }
  return normalizeUsers(saved);
}

async function saveUsers(users) {
  await getStore(STORE).setJSON(USERS_KEY, normalizeUsers(users));
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
}

async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [kind, salt, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hashHex) return false;
  const derived = await scrypt(password, salt, 64);
  const a = Buffer.from(derived);
  const b = Buffer.from(hashHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function createSession(user, sessionVersion) {
  const token = randomBytes(32).toString("base64url");
  const store = getStore(STORE);
  await store.setJSON(`session/${tokenHash(token)}`, {
    usuario: user,
    sessionVersion,
    expiresAt: Date.now() + SESSION_TTL
  });
  return token;
}

async function readSession(req, users) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const store = getStore(STORE);
  const session = await store.get(`session/${tokenHash(token)}`, { type: "json", consistency: "strong" });
  if (!session || !session.usuario || session.expiresAt < Date.now()) return null;
  const user = users[session.usuario];
  if (!user || session.sessionVersion !== user.sessionVersion || !user.passHash) return null;
  return { token, usuario: session.usuario, rol: user.rol };
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "status";
    const users = await getUsers();

    if (req.method === "GET" && action === "status") {
      return json({
        ok: true,
        usuarios: {
          VISCOMI: { configurada: !!users.VISCOMI.passHash, rol: "admin" },
          FLORES: { configurada: !!users.FLORES.passHash, rol: "operativo" }
        }
      });
    }

    if (req.method === "GET" && action === "check") {
      const session = await readSession(req, users);
      if (!session) return json({ ok:false, error:"Sesión no válida." }, 401);
      return json({ ok:true, usuario:session.usuario, rol:session.rol });
    }

    if (req.method !== "POST") return json({ok:false,error:"Método no permitido."},405);

    const body = await req.json();

    if (action === "login") {
      const user = String(body.usuario || "").toUpperCase();
      const pass = String(body.password || "");
      if (!["VISCOMI","FLORES"].includes(user)) return json({ok:false,error:"Usuario no válido."},400);
      if (pass.length < 4) return json({ok:false,error:"La contraseña debe tener al menos 4 caracteres."},400);

      if (!users[user].passHash) {
        users[user].passHash = await hashPassword(pass);
        await saveUsers(users);
      } else if (!(await verifyPassword(pass, users[user].passHash))) {
        return json({ok:false,error:"Contraseña incorrecta."},401);
      }

      const token = await createSession(user, users[user].sessionVersion);
      return json({ok:true, token, usuario:user, rol:users[user].rol});
    }

    if (action === "reset") {
      const session = await readSession(req, users);
      if (!session || session.usuario !== "VISCOMI") return json({ok:false,error:"Solo VISCOMI puede restablecer claves."},403);
      const target = String(body.usuario || "").toUpperCase();
      if (!["VISCOMI","FLORES"].includes(target)) return json({ok:false,error:"Usuario no válido."},400);
      users[target].passHash = null;
      users[target].sessionVersion += 1;
      await saveUsers(users);
      return json({ok:true, usuario:target});
    }

    return json({ok:false,error:"Acción no válida."},400);
  } catch (e) {
    console.error(e);
    return json({ok:false,error:"Error interno del servidor."},500);
  }
};

export const config = { path: "/api/auth" };
