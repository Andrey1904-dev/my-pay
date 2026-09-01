const CACHE_NAME="my-pay-v12";
const APP_SHELL=["./","./index.html","./style.css","./script.js?v=12","./manifest.webmanifest","./icon.svg"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("my-pay-v")&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  event.respondWith(
    fetch(event.request,{cache:"no-store"}).then(response=>{
      if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(event.request,response.clone()));
      return response;
    }).catch(()=>caches.match(event.request))
  );
});
self.addEventListener("push",event=>{
  let data={title:"Моя зарплата",body:"У тебя новое напоминание."};
  try{if(event.data)data={...data,...event.data.json()};}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:"./icon.svg",badge:"./icon.svg",data:data.data||{}}));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list)if("focus" in client)return client.focus();
    if(clients.openWindow)return clients.openWindow("./");
  }));
});