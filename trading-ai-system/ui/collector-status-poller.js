export function createCollectorStatusPoller({read, onStatus, onError, intervalMs=3000, timeoutMs=10000}) {
  let running=false, generation=0, timer=null, deadline=null, controller=null;
  async function poll(version) {
    controller=new AbortController();
    const currentController=controller;
    const timeout=new Promise((_,reject)=>{
      deadline=setTimeout(()=>{currentController.abort();reject(new Error('状态请求超时'));},timeoutMs);
    });
    try {
      const status=await Promise.race([read({signal:currentController.signal}),timeout]);
      if(running && generation===version) onStatus(status);
    } catch(error) {
      if(running && generation===version) onError(error);
    } finally {
      if(generation===version) {
        clearTimeout(deadline); deadline=null; controller=null;
        if(running) timer=setTimeout(()=>{timer=null;poll(version);},intervalMs);
      }
    }
  }
  function start() {
    if(running) return;
    running=true; generation++;
    poll(generation);
  }
  function stop() {
    running=false; generation++;
    clearTimeout(timer); clearTimeout(deadline);
    timer=null; deadline=null;
    controller?.abort(); controller=null;
  }
  return {start,stop};
}
