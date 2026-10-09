import test from "node:test";
import assert from "node:assert/strict";
import {validateFileProgress,parseFileRows,parsePageLedger,parseRouteHandlerLedger,parseActionLedger,isTrackedSourceCandidate} from "./check-migration-file-progress.mjs";

const currentRoutes="| Route | Current file | Class | Role |\n| --- | --- | --- | --- |\n| \x60/about\x60 | \x60app/(public)/about/page.tsx\x60 | VISUAL_SCREEN | public |";
const routeHandlers="| ID | Method | Route | Purpose |\n| --- | --- | --- | --- |\n| RH-018 | GET | /api/health | ok |";
const serverActions="| ID | Source action | Action |\n| --- | --- | --- |\n| SA-004 | \x60src/lib/actions/announcement.ts#createAnnouncement\x60 | create |";
const status="| ID | Task | State | Depends on |\n| --- | --- | --- | --- |\n| MIG-0501 | about | BLOCKED | MIG-0407 |\n| MIG-0601 | API | BLOCKED | MIG-0307 |\n| MIG-0303 | domains | BLOCKED | MIG-0308 |";
const filePaths=["app/(public)/about/page.tsx","app/api/health/route.ts","src/lib/actions/announcement.ts"];
const matrix=[
 "# File migration",
 "## Migration ledger",
 "| CURRENT path (exact) | Kind | Route / RH / SA linkage | First owner MIG | Target / bridge | File state | PR / tests / evidence |",
 "| --- | --- | --- | --- | --- | --- | --- |",
 "| \x60app/(public)/about/page.tsx\x60 | PAGE | /about (VISUAL_SCREEN) | MIG-0501 | +apps/site/src/pages/about.astro | NOT_STARTED | — |",
 "| \x60app/api/health/route.ts\x60 | ROUTE_HANDLER | RH-018:GET | MIG-0601 | +apps/api/src/routes/health.ts | NOT_STARTED | — |",
 "| \x60src/lib/actions/announcement.ts\x60 | SERVER_ACTION | SA-004 | MIG-0303 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |",
 "## Future files requiring source/target registration",
 ].join("\n");
const base={matrix,currentRoutes,routeHandlers,serverActions,status,filePaths};
const replace=(a,b)=>matrix.replace(a,b);
test("parse page, method, action contract links and source rows",()=>{
 assert.equal(parseFileRows(matrix).rows.size,3);
 assert.equal(parsePageLedger(currentRoutes).size,1);
 assert.equal(parseRouteHandlerLedger(routeHandlers).get("app/api/health/route.ts")[0],"RH-018:GET");
 assert.equal(parseActionLedger(serverActions).get("src/lib/actions/announcement.ts")[0],"SA-004");
 assert.equal(isTrackedSourceCandidate("app/(public)/about/page.tsx"),true);
});
test("accept complete file matrix and all source coverage",()=>assert.deepEqual(validateFileProgress(base),[]));
test("missing current source or changed file must fail",()=>{
 const broken=replace("| \x60src/lib/actions/announcement.ts\x60 | SERVER_ACTION | SA-004 | MIG-0303 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |","");
 assert.match(validateFileProgress({...base,matrix:broken}).join("\n"),/missing file progress row/);
 assert.match(validateFileProgress({...base,changedPaths:["src/lib/anotherModule.ts"]}).join("\n"),/changed migration source missing/);
});
test("duplicate file path must fail",()=>{
 const line="| \x60app/api/health/route.ts\x60 | ROUTE_HANDLER | RH-018:GET | MIG-0601 | +apps/api/src/routes/health.ts | NOT_STARTED | — |";
 const m=matrix.replace(line,line+"\n"+line);
 assert.match(validateFileProgress({...base,matrix:m}).join("\n"),/duplicate file row/);
});
test("RH method and SA contracts cannot be silently dropped",()=>{
 assert.match(validateFileProgress({...base,matrix:replace("RH-018:GET","RH-019:GET")}).join("\n"),/RH linkage mismatch/);
 assert.match(validateFileProgress({...base,matrix:replace("SA-004 |","SA-999 |")}).join("\n"),/SA linkage mismatch/);
 assert.match(validateFileProgress({...base,matrix:replace("/about (VISUAL_SCREEN)","/about (COMPAT_REDIRECT)")}).join("\n"),/route and class mismatch/);
});
test("progress needs valid PR+SHA, and advanced needs actual target/tests",()=>{
 const started=replace("NOT_STARTED | — |","IN_PROGRESS | — |");
 assert.match(validateFileProgress({...base,matrix:started}).join("\n"),/PR# and SHA/);
 const evidence="PR#278 SHA="+("a".repeat(40))+" TEST=node:test CI=https://github.com/org/repo/actions/runs/123";
 const advanced=replace("NOT_STARTED | — |","BRIDGED | "+evidence+" |");
 assert.match(validateFileProgress({...base,matrix:advanced}).join("\n"),/unverified target path/);
});
test("retiring source without approval is rejected",()=>{
 const evidence="PR#278 SHA="+("a".repeat(40))+" TEST=node:test CI=https://github.com/org/repo/actions/runs/123";
 const retired=replace("NOT_STARTED | — |","RETIRED | "+evidence+" |");
 assert.match(validateFileProgress({...base,matrix:retired}).join("\n"),/APPROVAL=/);
});
test("file owner must reference an actual MIG",()=>{
 assert.match(validateFileProgress({...base,matrix:replace("MIG-0501","MIG-9999")}).join("\n"),/missing owner task/);
});

test("a syntactically valid advanced target still must exist in source tree",()=>{
 const target="apps/site/src/pages/missing.astro";
 const evidence="PR#278 SHA="+("a".repeat(40))+" TEST=npm-run-typecheck CI=https://github.com/example/repo/actions/runs/123";
 const m=matrix.replace("+apps/site/src/pages/about.astro | NOT_STARTED | — |",target+" | BRIDGED | "+evidence+" |");
 assert.match(validateFileProgress({...base,matrix:m}).join("\\n"),/unverified target path/);
});

test("existing source mentioned in MIG cards requires its own ledger row",()=>{
 const extra="src/lib/slots/slotReservationLimit.ts";
 const errors=validateFileProgress({...base,filePaths:[...filePaths,extra],taskCardsText:"### MIG-0301 \\n- 読む: "+extra});
 assert.match(errors.join("\\n"),/missing file progress row for source/);
});

test("MIG marked DONE cannot leave owned files NOT_STARTED",()=>{
 const completed=status.replace("MIG-0501 | about | BLOCKED","MIG-0501 | about | DONE");
 const errors=validateFileProgress({...base,status:completed});
 assert.match(errors.join("\\n"),/owner MIG is DONE but file still NOT_STARTED/);
});

test("video-status SA must be owned by MIG-0304 (not user admin)",()=>{
 const file="src/lib/actions/admin.ts";
 const line="| `"+file+"` | SERVER_ACTION | SA-001 | MIG-0303 | domain policy | NOT_STARTED | — |";
 const altered=matrix.replace("## Future files",line+"\n## Future files");
 const sa=serverActions+"\n| SA-001 | `src/lib/actions/admin.ts#approveAdminVideoPublic` | video status |";
 const errs=validateFileProgress({...base,matrix:altered,serverActions:sa,filePaths:[...filePaths,file]});
 assert.match(errs.join("\n"),/incorrect first owner.*MIG-0304/);
});
test("event template SA must be owned by MIG-0303, not MIG-0305",()=>{
 const file="src/lib/actions/event-template-admin.ts";
 const line="| `"+file+"` | SERVER_ACTION | SA-035 | MIG-0501 | domain policy | NOT_STARTED | — |";
 const altered=matrix.replace("## Future files",line+"\n## Future files");
 const sa=serverActions+"\n| SA-035 | `src/lib/actions/event-template-admin.ts#saveEventAsTemplate` | save |";
 const errs=validateFileProgress({...base,matrix:altered,serverActions:sa,filePaths:[...filePaths,file]});
 assert.match(errs.join("\n"),/incorrect first owner.*MIG-0303/);
});
test("technical Next query renderer must not require duplicate Astro page",()=>{
 const file="app/(public)/event/~query/page.tsx";
 const line="| `"+file+"` | PAGE | /event/~query (SYSTEM_SURFACE) | MIG-0501 | +apps/site/src/pages/event/~query.astro | NOT_STARTED | — |";
 const altered=matrix.replace("## Future files",line+"\n## Future files");
 const routes=currentRoutes+"\n| `/event/~query` | `"+file+"` | SYSTEM_SURFACE | public |";
 const errs=validateFileProgress({...base,matrix:altered,currentRoutes:routes,filePaths:[...filePaths,file]});
 assert.match(errs.join("\n"),/technical Next renderer must migrate logical URL/);
});

test("technical renderer must share its canonical logical-page target",()=>{
 const twin="app/(public)/user/~query/page.tsx";
 const logical="app/(public)/user/page.tsx";
 const twoRows=[
   "| `"+logical+"` | PAGE | /user (VISUAL_SCREEN) | MIG-0501 | +apps/site/src/pages/user.astro | NOT_STARTED | — |",
   "| `"+twin+"` | PAGE | /user/~query (SYSTEM_SURFACE) | MIG-0501 | +apps/site/src/pages/user/index.astro (logical parity) | NOT_STARTED | — |",
 ].join("\n");
 const extended=matrix.replace("## Future files",twoRows+"\n## Future files");
 const urls=currentRoutes+"\n| `/user` | `"+logical+"` | VISUAL_SCREEN | public |\n| `/user/~query` | `"+twin+"` | SYSTEM_SURFACE | public |";
 const errors=validateFileProgress({...base,matrix:extended,currentRoutes:urls,filePaths:[...filePaths,logical,twin]});
 assert.match(errors.join("\n"),/target must match logical user-facing route target/);
});
