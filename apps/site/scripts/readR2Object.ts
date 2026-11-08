/** Build-only read access to the existing R2 analytics/trending.json artifact (MIG-0509 U02).
 * This is never used inside a Worker request. No R2 writes or token logging.
 */
export const MAX_R2_JSON_BYTES = 2 * 1024 * 1024;
export const R2_READ_TIMEOUT_MS = 15_000;
export const DEFAULT_R2_BUILD_BUCKET = "flamenode-storage";
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;
const BUCKET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export async function readR2Json(options: {
  accountId: string; bucket: string; key: string; token: string;
  fetchFn?: typeof fetch; maxBytes?: number;
}): Promise<unknown | null> {
  const {accountId,bucket,key,token}=options;
  const maxBytes=options.maxBytes ?? MAX_R2_JSON_BYTES;
  if (!ACCOUNT_ID.test(accountId)||!BUCKET.test(bucket)||!token ||
      !key||key.startsWith("/")||key.split("/").some(x=>!x||x==="."||x==="..") ||
      !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_R2_JSON_BYTES)
    throw new Error("R2 read requires account, bucket, object key and a read-only token");
  const url="https://api.cloudflare.com/client/v4/accounts/"+accountId+
    "/r2/buckets/"+encodeURIComponent(bucket)+"/objects/"+
    key.split("/").map(encodeURIComponent).join("/");
  let response: Response;
  try {
    response=await (options.fetchFn??fetch)(url,{
      method:"GET",headers:{Authorization:"Bearer "+token},
      signal:AbortSignal.timeout(R2_READ_TIMEOUT_MS),
    });
  }catch{
    throw new Error("R2 read failed (network or timeout)");
  }
  if(response.status===404)return null;
  if(!response.ok)throw new Error("R2 read failed (status="+response.status+")");
  const size=Number(response.headers.get("content-length")??"0");
  if(size>maxBytes)throw new Error("R2 object exceeds build JSON byte budget");
  if(!response.body)throw new Error("R2 object response body missing");
  const reader=response.body.getReader();
  let total=0;const chunks:Uint8Array[]=[];
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes)throw new Error("R2 object exceeds build JSON byte budget");
      chunks.push(value);
    }
  }catch(error){
    await reader.cancel().catch(()=>undefined);
    if(error instanceof Error&&error.message.includes("byte budget"))throw error;
    throw new Error("R2 read failed (stream)");
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);
  let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  try {return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as unknown;}
  catch{throw new Error("R2 object is not valid UTF-8 JSON");}
}
