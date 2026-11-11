import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { xidWriteStack, createXIdRoutes } from "../src/routes/xid/index.ts";
import { createXIdIconUploadRoutes } from "../src/routes/xid/iconUpload.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const USER = { id:"admin-1",name:"Admin",email:null,image:null,role:"user",
  is_banned:0,active_x_user_id:null };
const png = (size = 64) => {
  const parts = [137,80,78,71,13,10,26,10];
  const chunk=(name,data) => {
    const n=data.length;
    parts.push(n>>>24 & 255,n>>>16 & 255,n>>>8 & 255,n & 255,
      ...Array.from(name,c=>c.charCodeAt(0)),...data,0,0,0,0);
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0,size);
  new DataView(ihdr.buffer).setUint32(4,size);
  ihdr[8]=8; ihdr[9]=2;
  chunk("IHDR",ihdr);chunk("IDAT",new Uint8Array([0x78,1,1,0,0,255,255]));
  chunk("IEND",new Uint8Array(0));
  return new Uint8Array(parts);
};
function setup({ linked = true, approved = true, bucket = null, onFirst = null } = {}) {
  const {db,sqlite,stats}=createAdminD1({onFirst});
  seedBase(sqlite,{role:"user"});
  sqlite.prepare("INSERT INTO x_users (id,x_name,icon_url,approval_status) VALUES ('x_one','Creator',?,?)")
    .run("https://example.com/old.png",approved ? "approved" : "pending");
  if(linked) sqlite.prepare("INSERT INTO x_user_account_links (auth_user_id,x_user_id) VALUES (?,?)")
    .run(USER.id,"x_one");
  const writes=[],deletes=[];
  const r2=bucket??{
    put:async(key,data,options)=>{writes.push({key,bytes:data.byteLength,type:options.httpMetadata?.contentType});},
    delete:async(key)=>{deletes.push(key);},
  };
  let sessions=0;
  const session=async(c,next)=>{sessions++;c.set("user",{...USER});c.set("sessionState","user");await next();};
  const app=new Hono();
  app.route("/api/xid",createXIdIconUploadRoutes(xidWriteStack(session)));
  const send=(bytes=png(),{type="image/png",bodyXId="x_one",pathXId="x_one",origin=SITE,extra={}}={})=>{
    const form=new FormData();
    form.append("x_user_id",bodyXId);
    form.append("icon_file",new File([bytes],"avatar.png",{type}));
    for(const [key,value] of Object.entries(extra))form.append(key,value);
    return app.request(SITE+"/api/xid/"+pathXId+"/icon/upload",
      {method:"POST",headers:{Origin:origin},body:form},
      {DB:db,BUCKET:r2,NEXT_PUBLIC_SITE_URL:SITE});
  };
  return {sqlite,stats,writes,deletes,send,app,
    get sessions(){return sessions;}};
}

test("SA-105 isolated upload: authorized PNG uses staged+final R2, strict audit and rebuild in one D1 batch",async()=>{
  const h=setup();
  const res=await h.send();
  assert.equal(res.status,200,await res.text());
  assert.equal(res.headers.get("Cache-Control"),"private, no-store");
  const body=await res.json();
  assert.equal(body.ok,true);
  assert.match(body.iconUrl,/^\/api\/media\/xicons\/x_one\/xicon-[a-zA-Z0-9_-]+\.png$/);
  assert.equal(h.writes.length,2);
  assert.ok(h.writes[0].key.startsWith("xicons/staging/admin-1/"));
  assert.ok(h.writes[1].key.startsWith("xicons/x_one/"));
  assert.equal(h.writes[0].bytes,png().byteLength);
  assert.equal(h.writes[0].type,"image/png");
  assert.deepEqual(h.deletes,[h.writes[0].key],"only staged object deleted after commit");
  assert.equal(h.sqlite.prepare("SELECT icon_url FROM x_users WHERE id='x_one'").get().icon_url,body.iconUrl);
  const audit=h.sqlite.prepare("SELECT * FROM audit_logs WHERE table_name='x_users'").get();
  assert.ok(audit);
  assert.equal(audit.reason,"icon_upload");
  assert.equal(audit.actor_user_id,USER.id);
  assert.equal(audit.actor_x_user_id,"x_one");
  assert.equal(JSON.parse(audit.before_json).icon_url,"https://example.com/old.png");
  assert.equal(JSON.parse(audit.after_json).icon_url,body.iconUrl);
  assert.deepEqual(h.sqlite.prepare("SELECT target_type FROM static_rebuild_queue").all()
    .map(x=>x.target_type).sort(),["member_suggestions","user","users_index"]);
  assert.equal(h.stats.batches,1);
});

test("SA-105 isolated upload: invalid identity, malformed image, MIME mismatch and 2 MiB cap never touch R2",async()=>{
  for(const [name,bytes,options] of [
    ["bad signature",new TextEncoder().encode("<svg>"),{}],
    ["MIME forgery",png(),{type:"image/jpeg"}],
    ["undersized image",png(32),{}],
    ["oversized file",new Uint8Array(2*1024*1024+1),{}],
    ["invalid route",png(),{pathXId:"invalid-id!"}],
    ["mismatched target",png(),{bodyXId:"other_x"}],
  ]){
    const h=setup();
    const res=await h.send(bytes,options);
    assert.equal(res.status,400,name+": "+await res.text());
    assert.equal(h.writes.length,0,name);
    assert.equal(h.stats.batches,0,name);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,0,name);
  }
});

test("SA-105 isolated upload: unlinked/unapproved X cannot store an object",async()=>{
  for(const o of [{linked:false},{approved:false}]){
    const h=setup(o),res=await h.send();
    assert.equal(res.status,403,await res.text());
    assert.equal(h.writes.length,0);
    assert.equal(h.stats.batches,0);
  }
});

test("SA-105 isolated upload: rejected Origin precedes session and D1",async()=>{
  const h=setup(),res=await h.send(png(),{origin:"https://evil.invalid"});
  assert.equal(res.status,403);
  assert.equal(h.sessions,0);
  assert.equal(h.stats.reads,0);
  assert.equal(h.writes.length,0);
});

test("SA-105 isolated upload: >8 MiB actual multipart stream rejected before file parse or R2",async()=>{
  const h=setup();
  const res=await h.send(new Uint8Array(8*1024*1024+1));
  assert.equal(res.status,413);
  assert.equal((await res.json()).reason,"body_too_large");
  assert.equal(h.writes.length,0);
  assert.equal(h.stats.batches,0);
});

test("SA-105 isolated upload: failed final R2 put rolls back both new object keys",async()=>{
  const writes=[],deletes=[];
  const h=setup({bucket:{
    put:async key=>{writes.push(key);if(writes.length===2)throw Error("R2 unavailable");},
    delete:async key=>{deletes.push(key);},
  }});
  const res=await h.send();
  assert.equal(res.status,503);
  assert.deepEqual(deletes,writes);
  assert.equal(h.sqlite.prepare("SELECT icon_url FROM x_users WHERE id='x_one'").get().icon_url,
    "https://example.com/old.png");
  assert.equal(h.stats.batches,0);
});

test("SA-105 isolated upload: revoked X link between pre-read and CAS rolls back R2 and D1 audit",async()=>{
  let raced=false;
  const h=setup({onFirst:(sql,sqlite)=>{
    if(!raced&&sql.includes("FROM x_users AS x")&&sql.includes("x_user_account_links")){
      raced=true;
      sqlite.prepare("DELETE FROM x_user_account_links WHERE auth_user_id=?").run(USER.id);
    }
  }});
  const res=await h.send();
  assert.equal(raced,true);
  assert.equal(res.status,409,await res.text());
  assert.equal(h.writes.length,2);
  assert.deepEqual(h.deletes,h.writes.map(x=>x.key));
  assert.equal(h.sqlite.prepare("SELECT icon_url FROM x_users WHERE id='x_one'").get().icon_url,
    "https://example.com/old.png");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,0);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n,0);
});

test("SA-105 isolated upload: successful commit survives staging deletion error",async()=>{
  const keys=[];
  const h=setup({bucket:{
    put:async key=>{keys.push(key);},
    delete:async()=>{throw Error("R2 delete unavailable");},
  }});
  const res=await h.send();
  assert.equal(res.status,200,await res.text());
  assert.equal(keys.length,2);
  assert.equal(h.stats.batches,1);
});

test("SA-105 is not mounted on the public X ID router before accepted security/performance gates",()=>{
  const routes=createXIdRoutes();
  assert.equal(routes.routes.some(r=>r.method==="POST"&&r.path.includes("/icon/upload")),false);
});
