const endpoint='https://api.search.brave.com/res/v1/web/search';

export function readEnrichmentConfig(env=process.env){
  const integer=(key,fallback,max)=>/^[1-9]\d*$/.test(env[key]||'')?Math.min(max,Number(env[key])):fallback;
  return {key:env.PROSPECT_BRAVE_API_KEY?.trim()||'',enabled:env.PROSPECT_BRAVE_ENABLED==='true',
    batch:integer('PROSPECT_ENRICHMENT_BATCH',10,25),monthly:integer('PROSPECT_BRAVE_MONTHLY',300,1000)};
}

export async function searchProspectWeb(company,{key,fetcher,signal}){
  const url=new URL(endpoint);
  const clean=value=>String(value||'').replace(/["\r\n]/g,' ').trim();
  url.search=new URLSearchParams({q:`"${clean(company.name)}" ${clean(company.city)} ${clean(company.postal_code)} site officiel`,
    country:'FR',search_lang:'fr',count:'8'}).toString();
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),
    headers:{Accept:'application/json','X-Subscription-Token':key}});
  if(!response.ok||!response.body){
    await response.body?.cancel().catch(()=>{});
    throw Object.assign(new Error('Recherche web indisponible.'),{status:response.status});
  }
  const reader=response.body.getReader(),chunks=[];
  let bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>512000)throw new Error('Réponse de recherche trop volumineuse.');
      chunks.push(value);
    }
    const results=JSON.parse(Buffer.concat(chunks).toString('utf8'))?.web?.results;
    return Array.isArray(results)?results.slice(0,8).map(item=>item?.url).filter(url=>typeof url==='string'&&url.length<=2048):[];
  }finally{await reader.cancel().catch(()=>{});}
}
