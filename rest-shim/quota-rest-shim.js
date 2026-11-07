/* carbonio-ce-quotas — эмуляция REST квот Storages для admin-console-ui 0.20.x в Carbonio CE.
 *
 * Админка 0.20.x читает и пишет квоты через REST /services/storages/admin/quota/* (есть только
 * в платной редакции; в CE сервис отвечает 403 «RBAC: access denied»). Сами квоты в CE живут в
 * LDAP и сервером соблюдаются. Этот слой перехватывает fetch к этим адресам и отвечает через
 * штатный admin SOAP, в тех же форматах JSON, которые ждут экраны админки:
 *   GET    quota/accounts/{id}         → {total:{computedLimit:{type,value?,source},status,used},modules:{mailbox,files,wsc}}
 *   PUT    quota/config/accounts/{id}  {limit:{type,value?}}  → ModifyAccount zimbraMailQuota
 *   DELETE quota/config/accounts/{id}                          → снять zimbraMailQuota (наследовать COS)
 *   GET    quota/cos/{id}              → {computedLimit:{type,value?,source}}
 *   PUT    quota/config/cos/{id}       {limit:{type,value?}}  → ModifyCos zimbraMailQuota
 *   DELETE quota/config/cos/{id}                               → zimbraMailQuota=0
 *   GET    quota/config/domains/{id}   → {limit:байты} | 404 «не задано»
 *   PUT    quota/config/domains/{id}   {limit:байты}          → ModifyDomain zimbraMailDomainQuota
 *   DELETE quota/config/domains/{id}                           → снять zimbraMailDomainQuota
 *   отчёт домена (кнопка) → CSV из GetQuotaUsage (window.__cuQ.report)
 * Действующий лимит учётки = минимум из ненулевых zimbraMailQuota (учётка или её COS) и
 * zimbraMailDomainQuota домена — так его применяет сервер. Квоты Files/чатов в CE не хранятся →
 * их использование 0, лимит общий. Значения — байты.
 */
(()=>{
if(typeof window==="undefined"||window.__cuQ)return;
const of=window.fetch.bind(window);
const soap=async(n,b)=>{
  const r=await of(`/service/admin/soap/${n}Request`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({Header:{context:{_jsns:"urn:zimbra"}},Body:{[`${n}Request`]:{_jsns:"urn:zimbraAdmin",...b}}})});
  const j=await r.json();
  if(j?.Body?.Fault)throw new Error(j.Body.Fault.Reason?.Text||"SOAP fault");
  return j.Body[`${n}Response`];
};
const attr=(o,n)=>{const x=(o?.a||[]).find(a=>a.n===n);return x?x._content:undefined};
const num=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?Math.round(n):0};
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"Content-Type":"application/json"}});
const OK=()=>new Response(null,{status:204});
const ERR=e=>{console.error("[cuQuota]",e);return new Response(JSON.stringify({error:String(e?.message||e)}),{status:500,statusText:"Quota shim error",headers:{"Content-Type":"application/json"}})};
const lim=l=>l&&l.type==="limited"?String(num(l.value)):"0";
const body=async init=>{try{return JSON.parse(init?.body||"{}")}catch(_){return{}}};

const accountQuota=async id=>{
  const [raw,eff,mb]=await Promise.all([
    soap("GetAccount",{account:{by:"id",_content:id},applyCos:0,attrs:"zimbraMailQuota"}),
    soap("GetAccount",{account:{by:"id",_content:id},applyCos:1,attrs:"zimbraMailQuota"}),
    soap("GetMailbox",{mbox:{id}}).catch(()=>null)]);
  const acc=raw?.account?.[0]||{},name=acc.name||eff?.account?.[0]?.name||"",dn=name.split("@")[1]||"";
  const explicit=attr(acc,"zimbraMailQuota"),own=num(attr(eff?.account?.[0],"zimbraMailQuota"));
  let dq=0;
  if(dn){try{dq=num(attr((await soap("GetDomain",{domain:{by:"name",_content:dn},attrs:"zimbraMailDomainQuota"}))?.domain?.[0],"zimbraMailDomainQuota"))}catch(_){}}
  const c=[];own&&c.push({v:own,s:explicit!==undefined?"account":"cos"});dq&&c.push({v:dq,s:"domain"});
  c.sort((a,b)=>a.v-b.v);
  const computedLimit=c.length?{type:"limited",value:c[0].v,source:c[0].s}:{type:"unlimited",source:explicit!==undefined?"account":"global"};
  const used=num(mb?.mbox?.[0]?.s);
  return{total:{computedLimit,status:computedLimit.type==="limited"&&used>=computedLimit.value?"OVERQUOTA":"OK",used},
    modules:{mailbox:{used},files:{used:0},wsc:{used:0}}};
};
const cosQuota=async id=>{
  const q=num(attr((await soap("GetCos",{cos:{by:"id",_content:id},attrs:"zimbraMailQuota"}))?.cos?.[0],"zimbraMailQuota"));
  return{computedLimit:q?{type:"limited",value:q,source:"cos"}:{type:"unlimited",source:"global"}};
};
const domainQuota=async id=>num(attr((await soap("GetDomain",{domain:{by:"id",_content:id},attrs:"zimbraMailDomainQuota"}))?.domain?.[0],"zimbraMailDomainQuota"));

const route=async(path,init)=>{
  const m=/^\/services\/storages\/admin\/quota\/(config\/)?(accounts|cos|domains)\/([^/?#]+)/.exec(path);
  if(!m)return null;
  const cfg=!!m[1],kind=m[2],id=decodeURIComponent(m[3]),meth=(init?.method||"GET").toUpperCase();
  if(kind==="accounts"){
    if(!cfg&&meth==="GET")return J(await accountQuota(id));
    if(cfg&&meth==="PUT"){const b=await body(init);await soap("ModifyAccount",{id,a:[{n:"zimbraMailQuota",_content:lim(b.limit)}]});return OK()}
    if(cfg&&meth==="DELETE"){await soap("ModifyAccount",{id,a:[{n:"zimbraMailQuota",_content:""}]});return OK()}
  }
  if(kind==="cos"){
    if(!cfg&&meth==="GET")return J(await cosQuota(id));
    if(cfg&&meth==="GET"){const q=(await cosQuota(id)).computedLimit;return q.type==="limited"?J({limit:{type:"limited",value:q.value}}):J({},404)}
    if(cfg&&meth==="PUT"){const b=await body(init);await soap("ModifyCos",{id:{_content:id},a:[{n:"zimbraMailQuota",_content:lim(b.limit)}]});return OK()}
    if(cfg&&meth==="DELETE"){await soap("ModifyCos",{id:{_content:id},a:[{n:"zimbraMailQuota",_content:"0"}]});return OK()}
  }
  if(kind==="domains"&&cfg){
    if(meth==="GET"){const q=await domainQuota(id);return q?J({limit:q}):J({},404)}
    if(meth==="PUT"){const b=await body(init),v=typeof b.limit==="object"?num(b.limit?.value):num(b.limit);
      await soap("ModifyDomain",{id,a:[{n:"zimbraMailDomainQuota",_content:v?String(v):""}]});return OK()}
    if(meth==="DELETE"){await soap("ModifyDomain",{id,a:[{n:"zimbraMailDomainQuota",_content:""}]});return OK()}
  }
  return J({error:"not emulated"},404);
};

window.fetch=function(input,init){
  try{
    const u=typeof input==="string"?input:(input&&input.url)||"";
    const p=u.startsWith("http")?new URL(u).pathname:u;
    if(p.startsWith("/services/storages/admin/quota/")){
      const i=init||(input&&typeof input==="object"?{method:input.method}:undefined);
      return route(p,i).then(r=>r||of(input,init)).catch(ERR);
    }
  }catch(e){return Promise.resolve(ERR(e))}
  return of(input,init);
};

/* Блок «Использование квот» в разделе квот домена: сводка + таблица ящиков.
 * Фабрика от React и jsx-runtime сборки (подключение — одна замена в unlock_<версия>.json),
 * сам код от минифицированных имён не зависит. Лимит ящика = меньшее ненулевое из его
 * zimbraMailQuota (GetQuotaUsage.limit) и zimbraMailDomainQuota домена — как считает сервер. */
const RU=(document.documentElement.lang||navigator.language||"").toLowerCase().startsWith("ru");
const L=RU?{title:"Использование квот",total:"Занято в домене",boxes:"Ящиков",warn:t=>`≥ ${t}%`,full:"Заполнены (100%)",max:"Самый большой",
  search:"Поиск по адресу…",mbox:"Ящик",used:"Занято",limit:"Лимит",limAll:"Лимит ящика",pct:"%",unl:"без лимита",load:"Загрузка…",err:"Не удалось получить данные: ",
  none:"Нет ящиков",prev:"‹ Назад",next:"Вперёд ›",of:"из",refresh:"Обновить"}
 :{title:"Quota usage",total:"Used in domain",boxes:"Mailboxes",warn:t=>`≥ ${t}%`,full:"Full (100%)",max:"Largest",
  search:"Search by address…",mbox:"Mailbox",used:"Used",limit:"Limit",limAll:"Mailbox limit",pct:"%",unl:"unlimited",load:"Loading…",err:"Failed to load: ",
  none:"No mailboxes",prev:"‹ Prev",next:"Next ›",of:"of",refresh:"Refresh"};
const fmt=b=>{b=num(b);if(!b)return"0";const u=RU?["Б","КБ","МБ","ГБ","ТБ"]:["B","KB","MB","GB","TB"];let i=Math.min(Math.floor(Math.log(b)/Math.log(1024)),u.length-1);return(b/1024**i).toFixed(i>=3?2:i?1:0).replace(".",RU?",":".")+" "+u[i]};
const loadDomain=async dn=>{
  const [r,d]=await Promise.all([
    soap("GetQuotaUsage",{domain:dn,offset:0,limit:10000,sortBy:"totalUsed",sortAscending:0,refresh:"1",allServers:"1"}),
    soap("GetDomain",{domain:{by:"name",_content:dn},attrs:"zimbraMailDomainQuota"}).catch(()=>null)]);
  const dq=num(attr(d?.domain?.[0],"zimbraMailDomainQuota"));
  return(r?.account||[]).map(a=>{const own=num(a.limit),lim=own&&dq?Math.min(own,dq):(own||dq),used=num(a.used);
    return{id:a.id,name:a.name,used,limit:lim,pct:lim?used/lim*100:null}});
};
/* Настройки предупреждений о заполнении (zimbraQuotaWarnPercent / zimbraQuotaWarnInterval). В 0.20 их UI убран;
 * атрибуты живут на COS (и учётке), не на домене — правим COS по умолчанию домена и показываем, кому ещё он служит. */
const parseIntervalH=v=>{const m=/^(\d+)\s*(ms|[dhms])?$/.exec(String(v||"").trim());if(!m)return 24;const n=+m[1],u=m[2]||"s";
  return u==="d"?n*24:u==="h"?n:u==="m"?n/60:u==="ms"?n/3600000:n/3600};
const loadWarn=async dn=>{
  const d=(await soap("GetDomain",{domain:{by:"name",_content:dn},attrs:"zimbraDomainDefaultCOSId"}))?.domain?.[0];
  let cosId=attr(d,"zimbraDomainDefaultCOSId");
  const cos=(await soap("GetCos",{cos:cosId?{by:"id",_content:cosId}:{by:"name",_content:"default"},attrs:"zimbraQuotaWarnPercent,zimbraQuotaWarnInterval"}))?.cos?.[0];
  cosId=cos?.id||cosId;
  const def=(await soap("GetCos",{cos:{by:"name",_content:"default"},attrs:"cn"}))?.cos?.[0]?.id;
  const all=(await soap("SearchDirectory",{types:"domains",attrs:"zimbraDomainName,zimbraDomainDefaultCOSId",limit:1000,offset:0,applyCos:"false",applyConfig:"false"}))?.domain||[];
  const shared=all.filter(x=>(attr(x,"zimbraDomainDefaultCOSId")||def)===cosId).map(x=>x.name).filter(n=>n!==dn);
  return{cosId,cosName:cos?.name||"default",pct:String(attr(cos,"zimbraQuotaWarnPercent")??"90"),hours:String(Math.round(parseIntervalH(attr(cos,"zimbraQuotaWarnInterval")??"1d")*100)/100),shared};
};
const LW=RU?{title:"Предупреждения о заполнении ящика",pct:"Порог предупреждения, %",hours:"Интервал между предупреждениями, часов",save:"Сохранить",saved:"Сохранено",
  note:(c,s)=>`Настройки класса обслуживания «${c}» — действуют на все ящики с этим COS`+(s.length?`, в том числе в доменах: ${s.join(", ")}`:" (других доменов с ним по умолчанию нет)")+". Индивидуальная настройка учётки, если задана, важнее.",
  bad:"Порог — целое от 1 до 100, интервал — число часов больше 0"}
 :{title:"Mailbox full warnings",pct:"Warning threshold, %",hours:"Interval between warnings, hours",save:"Save",saved:"Saved",
  note:(c,s)=>`Class of Service “${c}” settings — apply to every mailbox with this COS`+(s.length?`, including domains: ${s.join(", ")}`:"")+".",bad:"Threshold 1–100, interval > 0 hours"};

window.__cuDomQuotaFactory=(R,J,UI)=>function CuDomQuota(props){
  const dn=props.domainName,[rows,setRows]=R.useState(null),[err,setErr]=R.useState(""),[q,setQ]=R.useState(""),
    [sort,setSort]=R.useState({k:"used",d:-1}),[off,setOff]=R.useState(0),[ps,setPs]=R.useState(10),[tick,setTick]=R.useState(0);
  R.useEffect(()=>{let live=!0;setRows(null);setErr("");if(dn)loadDomain(dn).then(x=>{live&&setRows(x)}).catch(e=>{live&&setErr(String(e?.message||e))});return()=>{live=!1}},[dn,tick]);
  const [warn,setWarn]=R.useState(null),[wf,setWf]=R.useState({pct:"",hours:""}),[wst,setWst]=R.useState("");
  R.useEffect(()=>{let live=!0;setWarn(null);setWst("");if(dn)loadWarn(dn).then(w=>{if(live){setWarn(w);setWf({pct:w.pct,hours:w.hours})}}).catch(e=>{live&&setWst(L.err+(e?.message||e))});return()=>{live=!1}},[dn]);
  const h=J.jsx,hs=J.jsxs,u=UI||{};
  const T=(ch,o)=>h("ds-text",{as:"span",size:"small",color:"gray0",weight:"light",...o,children:ch});
  // порог = «Порог предупреждения» из формы ниже (zimbraQuotaWarnPercent COS по умолчанию домена); до загрузки — 90 (дефолт сервера)
  const thr=warn&&Number(warn.pct)>0?Number(warn.pct):90;
  const tone=p=>p==null?"gray0":p>=100?"error":p>=thr?"warning":"gray0";
  // данные
  let tot=0,w80=0,full=0,big=null,f=[];
  if(rows){
    rows.forEach(r=>{tot+=r.used;r.pct!=null&&r.pct>=100?full++:r.pct!=null&&r.pct>=thr&&w80++;(!big||r.used>big.used)&&(big=r)});
    f=rows.filter(r=>!q||r.name.toLowerCase().includes(q.toLowerCase()));
    const val=r=>sort.k==="name"?r.name:sort.k==="pct"?(r.pct??-1):sort.k==="limit"?(r.limit||Infinity):r.used;
    f.sort((a,b)=>{const x=val(a),y=val(b);return(x<y?-1:x>y?1:0)*sort.d});
  }
  const slice=f.slice(off,off+ps);
  if(!u.Q){ // запасной вариант без компонентов сборки
    return h("div",{style:{padding:"16px"},children:T(rows?`${L.total}: ${fmt(tot)}`:(err?L.err+err:L.load))});
  }
  const {Q,Row,Table,RowF,HeadF,Pager,PageSize,Input,Field,Btn}=u;
  const header=h(Row,{mainAlignment:"flex-start",width:"100%",background:"gray6",padding:{top:"large",left:"small"},
    children:h("ds-text",{as:"h3",size:"small",weight:"bold",color:"gray0",children:L.title})});
  // форма предупреждений
  const pctN=Number(wf.pct),hN=Number(String(wf.hours).replace(",",".")),wValid=Number.isInteger(pctN)&&pctN>=1&&pctN<=100&&hN>0,
    wDirty=!!warn&&(wf.pct!==warn.pct||String(wf.hours)!==warn.hours);
  const saveWarn=()=>{if(!wValid||!warn)return;setWst("…");
    const iv=Number.isInteger(hN)?`${hN}h`:`${Math.round(hN*60)}m`;
    soap("ModifyCos",{id:{_content:warn.cosId},a:[{n:"zimbraQuotaWarnPercent",_content:String(pctN)},{n:"zimbraQuotaWarnInterval",_content:iv}]})
      .then(()=>{const w={...warn,pct:String(pctN),hours:String(hN)};setWarn(w);setWf({pct:w.pct,hours:w.hours});setWst(LW.saved)})
      .catch(e=>setWst(L.err+(e?.message||e)))};
  const warnSection=hs(Q,{mainAlignment:"flex-start",crossAlignment:"flex-start",width:"100%",children:[
    h(Row,{mainAlignment:"flex-start",width:"100%",background:"gray6",padding:{top:"large",left:"small"},
      children:h("ds-text",{as:"h3",size:"small",weight:"bold",color:"gray0",children:LW.title})}),
    hs(Row,{width:"100%",mainAlignment:"flex-start",crossAlignment:"center",padding:{top:"large",left:"small",right:"small"},style:{gap:"1rem"},children:[
      h(Q,{width:"30%",mainAlignment:"flex-start",children:h(Input,{label:LW.pct,value:wf.pct,backgroundColor:"gray5",disabled:!warn,
        hasError:!!warn&&!wValid,onChange:e=>{setWf(f=>({...f,pct:e.target.value.replace(/\D/g,"")}));setWst("")}})}),
      h(Q,{width:"30%",mainAlignment:"flex-start",children:h(Input,{label:LW.hours,value:wf.hours,backgroundColor:"gray5",disabled:!warn,
        hasError:!!warn&&!wValid,onChange:e=>{setWf(f=>({...f,hours:e.target.value.replace(/[^\d.,]/g,"")}));setWst("")}})}),
      h(Btn,{type:"outlined",color:"primary",label:LW.save,disabled:!wDirty||!wValid,onClick:saveWarn}),
      wst?T(wst,{color:wst===LW.saved?"success":wst==="…"?"secondary":"error"}):null]}),
    h(Row,{width:"100%",mainAlignment:"flex-start",padding:{top:"small",left:"small",right:"small"},
      children:T(warn?LW.note(warn.cosName,warn.shared):(wst||L.load),{color:"secondary",overflow:"break-word"})})]});
  if(err||!rows)return hs(Q,{mainAlignment:"flex-start",crossAlignment:"flex-start",width:"100%",children:[warnSection,header,
    h(Row,{mainAlignment:"flex-start",width:"100%",padding:{all:"large"},children:T(err?L.err+err:L.load,{color:err?"error":"secondary"})})]});
  // лимит у всех одинаковый (обычно — квота домена) → столбец не нужен, показываем одно поле в сводке
  const same=rows.length>0&&rows.every(r=>r.limit===rows[0].limit);
  // значение в одну строку (иначе переносится и наезжает на подпись поля), полный текст — в подсказке
  const one=v=>h("span",{title:v,style:{display:"block",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"},children:v});
  const fld=(lab,val,w)=>h(Q,{width:w||(same?"12%":"14%"),mainAlignment:"flex-start",style:{minWidth:0},children:h(Field,{label:lab,value:one(val),backgroundColor:"gray6"})});
  const summary=hs(Row,{width:"100%",mainAlignment:"space-between",padding:{top:"large",left:"small",right:"small"},children:[
    fld(L.total,fmt(tot)),fld(L.boxes,String(rows.length)),...(same?[fld(L.limAll,rows[0].limit?fmt(rows[0].limit):L.unl)]:[]),fld(L.warn(thr),String(w80)),fld(L.full,String(full)),fld(L.max,big?`${big.name} — ${fmt(big.used)}`:"—",same?"36%":"40%")]});
  const onSort=(id,ord)=>{setSort({k:id,d:ord==="asc"?1:-1});setOff(0)};
  const headers=[
    {id:"name",label:L.mbox,width:same?"50%":"40%",bold:!0,sortable:!0,onSortChange:onSort},
    {id:"used",label:L.used,width:same?"22%":"16%",bold:!0,sortable:!0,onSortChange:onSort},
    ...(same?[]:[{id:"limit",label:L.limit,width:"16%",bold:!0,sortable:!0,onSortChange:onSort}]),
    {id:"pct",label:L.pct,width:"10%",bold:!0,sortable:!0,onSortChange:onSort},
    {id:"bar",label:"",width:"18%",bold:!0}];
  const bar=p=>p==null?T("\xA0"):h(Q,{orientation:"horizontal",mainAlignment:"flex-start",width:"7rem",height:"0.5rem",background:"gray3",
    style:{borderRadius:"0.25rem",overflow:"hidden"},children:h(Q,{width:Math.max(Math.min(p,100),1)+"%",height:"100%",background:p>=100?"error":p>=thr?"warning":"success"})});
  const trows=slice.map(r=>({id:r.id,clickable:!1,columns:[
    T(r.name,{weight:"regular"}),T(fmt(r.used)),...(same?[]:[T(r.limit?fmt(r.limit):L.unl,{color:r.limit?"gray0":"secondary"})]),
    T(r.pct==null?"—":Math.floor(r.pct)+"%",{color:tone(r.pct),weight:r.pct!=null&&r.pct>=thr?"bold":"light"}),bar(r.pct)]}));
  const search=hs(Row,{width:"100%",mainAlignment:"space-between",crossAlignment:"center",padding:{top:"large",left:"small",right:"small"},children:[
    h(Q,{width:"50%",mainAlignment:"flex-start",children:h(Input,{label:L.search,value:q,backgroundColor:"gray5",onChange:e=>{setQ(e.target.value);setOff(0)}})}),
    h(Btn,{type:"outlined",color:"primary",label:L.refresh,icon:"RefreshOutline",onClick:()=>setTick(t=>t+1)})]});
  const table=h(Row,{width:"100%",padding:{top:"large",left:"small",right:"small"},children:trows.length?h(Table,{rows:trows,headers,showCheckbox:!1,multiSelect:!1,
    RowFactory:RowF,HeaderFactory:HeadF,style:{width:"100%"}}):T(L.none,{color:"secondary"})});
  const paging=f.length>ps||ps!==10?hs(Row,{width:"100%",mainAlignment:"space-between",padding:{top:"medium",left:"small",right:"small",bottom:"large"},children:[
    h(Q,{width:"fit",crossAlignment:"flex-start",children:h(Pager,{totalItem:f.length,setOffset:setOff,pageSize:ps},`${q}|${sort.k}|${sort.d}|${ps}`)}),
    h(Q,{width:"fit",crossAlignment:"flex-end",children:h(PageSize,{setPageSize:n=>{setPs(n);setOff(0)}})})]}):null;
  return hs(Q,{mainAlignment:"flex-start",crossAlignment:"flex-start",width:"100%",padding:{bottom:"large"},children:[warnSection,header,summary,search,table,paging]});
};

window.__cuQ={
  report:async dn=>{
    try{
      const r=await soap("GetQuotaUsage",{domain:dn,offset:0,limit:10000,sortBy:"totalUsed",sortAscending:0,refresh:"1",allServers:"1"});
      const gb=b=>(num(b)/1073741824).toFixed(3).replace(".",",");
      const rows=[["account","used_bytes","limit_bytes","used_gb","limit_gb","percent"].join(";")];
      (r?.account||[]).forEach(a=>{const u=num(a.used),l=num(a.limit);rows.push([a.name,u,l,gb(u),l?gb(l):"",l?Math.floor(u/l*100):""].join(";"))});
      const blob=new Blob(["﻿"+rows.join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),el=document.createElement("a");
      el.href=url;el.download=`quota-${dn}.csv`;document.body.appendChild(el);el.click();el.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    }catch(e){console.error("[cuQuota] report",e);alert("Quota report failed: "+(e?.message||e))}
  }
};
})();
