const CACHE='bluerock-ims-shell-v2';
const SHELL=['/','/manifest.webmanifest','/icons/192','/icons/512'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;

  // App routes are always network-first and are never written over the root shell.
  // This avoids caching /scanner-config (or any other page) under the '/' key and
  // prevents cloning a navigation response after its body has already been consumed.
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(async()=>{
      const fallback=await caches.match('/');
      return fallback||Response.error();
    }));
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(request);
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>undefined));
    }
    return response;
  })());
});
