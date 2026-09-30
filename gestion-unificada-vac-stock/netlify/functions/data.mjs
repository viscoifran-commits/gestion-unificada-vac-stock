import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const STORE = "gestion-unificada";
const CHUNK_SIZE = 3_500_000;
const MODULES = new Set(["vac", "stock"]);

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function getUsers() {
  const store = getStore(STORE);
  const users = await store.get("auth/users", {type:"json", consistency:"strong"});
  return users || {};
}

async function authorize(req) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const store = getStore(STORE);
  const session = await store.get(`session/${tokenHash(token)}`, {type:"json", consistency:"strong"});
  if (!session || session.expiresAt < Date.now()) return null;
  const users = await getUsers();
  const user = users[session.usuario];
  if (!user || !user.passHash || Number(user.sessionVersion) !== Number(session.sessionVersion)) return null;
  return {usuario:session.usuario, rol:user.rol};
}

function validModule(m) { return MODULES.has(m); }

async function readMeta(store, module) {
  return await store.get(`meta/${module}`, {type:"json", consistency:"strong"});
}

export default async (req) => {
  try {
    const session = await authorize(req);
    if (!session) return json({ok:false,error:"No autorizado."},401);

    const url = new URL(req.url);
    const module = url.searchParams.get("module");
    if (!validModule(module)) return json({ok:false,error:"Módulo no válido."},400);

    const store = getStore(STORE);

    if (req.method === "GET") {
      const meta = await readMeta(store, module);
      if (!meta) return json({ok:true,exists:false,keys:{},module});

      const index = url.searchParams.get("index");
      if (index !== null) {
        const i = Number(index);
        if (!Number.isInteger(i) || i < 0 || i >= meta.total) return json({ok:false,error:"Índice no válido."},400);
        const value = await store.get(`data/${module}/${meta.version}/${i}`, {type:"text", consistency:"strong"});
        return json({ok:true,exists:true,module,index:i,total:meta.total,value:value ?? ""});
      }

      return json({ok:true,exists:true,module,total:meta.total,version:meta.version,updatedAt:meta.updatedAt});
    }

    if (req.method !== "POST") return json({ok:false,error:"Método no permitido."},405);

    const body = await req.json();
    const version = String(body.version || "");
    const index = Number(body.index);
    const total = Number(body.total);
    const value = typeof body.value === "string" ? body.value : "";

    if (!/^[A-Za-z0-9_-]{10,80}$/.test(version)) return json({ok:false,error:"Versión inválida."},400);
    if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) return json({ok:false,error:"Chunk inválido."},400);
    if (value.length > CHUNK_SIZE) return json({ok:false,error:"Chunk demasiado grande."},413);

    await store.set(`data/${module}/${version}/${index}`, value);

    if (body.final === true) {
      const previous = await readMeta(store, module);
      const meta = {version,total,updatedAt:new Date().toISOString(),updatedBy:session.usuario};
      await store.setJSON(`meta/${module}`, meta);

      if (previous?.version && previous.version !== version) {
        const deletions = [];
        for (let i=0;i<Number(previous.total||0);i++) deletions.push(store.delete(`data/${module}/${previous.version}/${i}`));
        await Promise.all(deletions);
      }
    }

    return json({ok:true,index,total,final:body.final===true});
  } catch (e) {
    console.error(e);
    return json({ok:false,error:"Error interno del servidor."},500);
  }
};

export const config = { path: "/api/data" };
