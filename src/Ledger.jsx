import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, getDoc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAt, endAt } from 'firebase/firestore';
import { auth, db } from './firebase';
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, Info, Lock, Truck } from 'lucide-react';
import './Ledger.css';

// Ref.: hoja MOV-GARRAFAS de la matriz y saldos iniciales de Inicio!K35:K37.
// Cálculos equivalentes: G=B+C+D-E-F; K=E; L=F; N=J+K+L-M; P=G+N.
// Facturas: V=(T-T_anterior)+(U-U_anterior), conservando la serie anterior al reiniciar.
const editableFields = ['plantFull','replacementFull','soldFull','defectiveFull','emptiesToPlant'];
const emptyForm = () => ({plantFull:'0',replacementFull:'0',soldFull:'0',defectiveFull:'0',emptiesToPlant:'0',invoiceA:'',invoiceB:'',unitPrice:'',nonWorking:false,note:'',physicalFull:'',physicalEmpty:''});
const dateIso = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
const moveDay = (s, diff) => {const d=new Date(`${s}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+diff);return dateIso(d);};
const todayBolivia = () => {const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const v=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`;};
const parseInteger = (x, label) => {if(!/^\d+$/.test(String(x).trim()))throw new Error(`Ingresa ${label} como número entero no negativo.`);const n=Number(x);if(!Number.isSafeInteger(n)||n>1000000)throw new Error(`La cantidad de ${label} está fuera de rango.`);return n;};
const parseInvoice = (x, previous) => String(x).trim()===''?previous:parseInteger(x,'factura final');
const formattedNumber = value => new Intl.NumberFormat('es-BO',{maximumFractionDigits:0}).format(value??0);
const formattedMoney = value => new Intl.NumberFormat('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value??0);
const recordId = (capacity,date) => `${capacity}_${date}`;
const routeDate = x => {if(!x?.toDate)return null;const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(x.toDate());const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;};

function calculate(prev, entry, inheritedPrice='') {
  const v=Object.fromEntries(editableFields.map(k=>[k,parseInteger(entry[k],k)]));
  const invoiceA=parseInvoice(entry.invoiceA,prev.invoiceA);
  const invoiceB=parseInvoice(entry.invoiceB,prev.invoiceB);
  if(invoiceA<prev.invoiceA || invoiceB<prev.invoiceB)throw new Error('Los correlativos no pueden retroceder. Al reiniciar facturas conserva el último final de la primera serie y registra la segunda desde 1.');
  if(entry.nonWorking && (Object.values(v).some(n=>n!==0)||invoiceA!==prev.invoiceA||invoiceB!==prev.invoiceB))throw new Error('Un día sin actividad no puede incluir movimientos ni avance de facturas.');
  const priceRaw=String(entry.unitPrice).trim()||String(inheritedPrice).trim();
  const price=priceRaw===''?0:Number(priceRaw.replace(',','.'));
  if(!Number.isFinite(price)||price<0||price>100000)throw new Error('El precio unitario debe ser válido.');
  const invoiceUnits=invoiceA-prev.invoiceA+invoiceB-prev.invoiceB;
  if((v.soldFull>0||invoiceUnits>0)&&priceRaw==='')throw new Error('Ingresa el precio de referencia cuando haya movimientos facturados.');
  // K=E y L=F: en esta distribuidora NO se venden envases; solo se intercambia GLP.
  const receivedEmpty=v.soldFull;
  const defectiveEmpty=v.defectiveFull;
  const full=prev.full+v.plantFull+v.replacementFull-v.soldFull-v.defectiveFull;
  const empty=prev.empty+receivedEmpty+defectiveEmpty-v.emptiesToPlant;
  if(full<0||empty<0)throw new Error('Saldo insuficiente: verifica recepción de llenas, envíos a planta y entregas antes de cerrar.');
  const physicalFull=String(entry.physicalFull).trim()===''?null:parseInteger(entry.physicalFull,'conteo físico de llenas');
  const physicalEmpty=String(entry.physicalEmpty).trim()===''?null:parseInteger(entry.physicalEmpty,'conteo físico de vacías');
  const physicalDiff=(physicalFull===null||physicalEmpty===null)?null:(physicalFull+physicalEmpty)-(full+empty);
  const invoiceDiff=invoiceUnits-v.soldFull;
  return {...v,openingFull:prev.full,openingEmpty:prev.empty,openingInvoiceA:prev.invoiceA,openingInvoiceB:prev.invoiceB,receivedEmpty,defectiveEmpty,full,empty,total:full+empty,invoiceA,invoiceB,invoiceUnits,price,estimatedAmount:Math.round(price*invoiceUnits*100)/100,invoiceDiff,exchangeDiff:0,physicalFull,physicalEmpty,physicalDiff,nonWorking:Boolean(entry.nonWorking),note:String(entry.note||'').trim().slice(0,300)};
}

function Quantity({value,onChange,disabled=false,label,wide=false,placeholder}) {
  return <input className={`glp-cell-input ${wide?'glp-wide':''}`} title={label} aria-label={label} type="number" min="0" inputMode="numeric" step="1" value={value} placeholder={placeholder} disabled={disabled} onChange={e=>onChange(e.target.value)}/>;
}

const note = n => n===null||n===undefined?'—':formattedNumber(n);
function Calculated({value,important=false}) {return <span className={important?'glp-total':''}>{note(value)}</span>;}
function DailyReadOnly({date,row,kind}) {
  const d=row;
  if(!d) return <tr className="glp-no-row"><td className="glp-date">{date.slice(8)}<small>{kind==='future'?'Siguiente día':'Sin registro'}</small></td>{Array.from({length:18},(_,idx)=><td key={idx}>{kind==='future'&&[1,2,3,4,7,8,9,13,14,15].includes(idx)?'0':'—'}</td>)}</tr>;
  return <tr><td className="glp-date">{date.slice(8)}<small>{d.nonWorking?'Sin actividad':d.status==='pendiente'?'Pendiente':'Registrado'}</small></td>
    <td>{note(d.openingFull)}</td><td>{note(d.plantFull)}</td><td>{note(d.replacementFull)}</td><td>{note(d.soldFull)}</td><td>{note(d.defectiveFull)}</td><td className="glp-cell-result">{note(d.full)}</td>
    <td>{note(d.openingEmpty)}</td><td className="glp-cell-auto">{note(d.receivedEmpty)}</td><td className="glp-cell-auto">{note(d.defectiveEmpty)}</td><td>{note(d.emptiesToPlant)}</td><td className="glp-cell-result">{note(d.empty)}</td>
    <td className="glp-cell-result">{note(d.total)}</td>
    <td>{note(d.invoiceA)}</td><td>{note(d.invoiceB)}</td><td className="glp-cell-auto">{note(d.invoiceUnits)}</td><td>{formattedMoney(d.price)}</td><td className="glp-cell-result">{formattedMoney(d.estimatedAmount)}</td><td className={d.invoiceDiff?'glp-alert':'glp-ok'}>{d.invoiceDiff?'Diferencia':'OK'}</td></tr>;
}

export default function Ledger({profile}) {
  const editable=profile.role==='admin';
  const [capacity,setCapacity]=useState('10');
  const [month,setMonth]=useState(todayBolivia().slice(0,7));
  const [head,setHead]=useState(null);
  const [headLoading,setHeadLoading]=useState(true);
  const [monthly,setMonthly]=useState([]);
  const [nearby,setNearby]=useState({});
  const [draft,setDraft]=useState(emptyForm);
  const [opening,setOpening]=useState({date:todayBolivia(),full:'',empty:'',invoiceA:'',invoiceB:'0'});
  const [lastPrice,setLastPrice]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [saving,setSaving]=useState(false);
  const [drivers,setDrivers]=useState(null);

  useEffect(()=>{setHead(null);setHeadLoading(true);setDraft(emptyForm());setLastPrice('');setNearby({});setDrivers(null);setError('');
    return onSnapshot(doc(db,'glpLedgerState',capacity),snap=>{setHead(snap.exists()?snap.data():null);setHeadLoading(false);},err=>{setError(err.message);setHeadLoading(false);});},[capacity]);
  useEffect(()=>{const prefix=`${capacity}_${month}-`;return onSnapshot(query(collection(db,'glpDaily'),orderBy('__name__'),startAt(prefix+'01'),endAt(prefix+'31')),snap=>setMonthly(snap.docs.map(d=>d.data())),err=>setError(err.message));},[capacity,month]);
  const nextDate=head?moveDay(head.lastDate,1):opening.date;
  useEffect(()=>{if(!head?.lastDate)return;return onSnapshot(doc(db,'glpDaily',recordId(capacity,head.lastDate)),snap=>{if(snap.exists())setLastPrice(String(snap.data().price??''));},()=>{});},[capacity,head?.lastDate]);
  useEffect(()=>{const dates=Array.from({length:5},(_,i)=>moveDay(nextDate,i-3));const stop=dates.map(day=>onSnapshot(doc(db,'glpDaily',recordId(capacity,day)),snap=>setNearby(old=>({...old,[day]:snap.exists()?snap.data():null})),()=>{}));return ()=>stop.forEach(f=>f());},[capacity,nextDate]);
  const startOk=!head && opening.full!==''&&opening.empty!==''&&opening.invoiceA!==''&&opening.invoiceB!=='';
  const previous=head?{full:head.full,empty:head.empty,invoiceA:head.invoiceA,invoiceB:head.invoiceB}:{full:Number(opening.full),empty:Number(opening.empty),invoiceA:Number(opening.invoiceA),invoiceB:Number(opening.invoiceB)};
  const preview=useMemo(()=>{try{return (head||startOk)?calculate(previous,draft,lastPrice):null;}catch{return null;}},[head,startOk,previous.full,previous.empty,previous.invoiceA,previous.invoiceB,draft,lastPrice]);
  const today=todayBolivia();
  const days=Array.from({length:5},(_,i)=>moveDay(nextDate,i-3));
  const map=useMemo(()=>Object.fromEntries(monthly.map(x=>[x.date,x])),[monthly]);
  const monthDays=useMemo(()=>Array.from({length:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate()},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`),[month]);
  const totals=useMemo(()=>monthly.reduce((s,r)=>({received:s.received+(r.plantFull||0)+(r.replacementFull||0),delivered:s.delivered+(r.soldFull||0),empties:s.empties+(r.receivedEmpty||0),toPlant:s.toPlant+(r.emptiesToPlant||0),invoices:s.invoices+(r.invoiceUnits||0),amount:s.amount+(r.estimatedAmount||0)}),{received:0,delivered:0,empties:0,toPlant:0,invoices:0,amount:0}),[monthly]);
  const update=(k,val)=>setDraft(x=>({...x,[k]:val}));
  const activeNumbers=(field,label)=><Quantity label={label} value={draft[field]} disabled={!editable||draft.nonWorking} onChange={v=>update(field,v)}/>;
  const carryA=previous.invoiceA??0,carryB=previous.invoiceB??0;

  const closeDay=async()=>{
    setError('');setNotice('');setSaving(true);
    try{
      if(!editable)throw new Error('Solo el administrador puede cerrar movimientos.');
      if(nextDate>today)throw new Error('No se permiten cierres en fechas futuras.');
      const base=head?{full:head.full,empty:head.empty,invoiceA:head.invoiceA,invoiceB:head.invoiceB}:{full:parseInteger(opening.full,'saldo inicial de llenas'),empty:parseInteger(opening.empty,'saldo inicial de vacías'),invoiceA:parseInteger(opening.invoiceA,'factura inicial primera serie'),invoiceB:parseInteger(opening.invoiceB,'factura inicial segunda serie')};
      const result=calculate(base,draft,lastPrice);
      const hasProblems=result.invoiceDiff!==0 || (result.physicalDiff!==null&&result.physicalDiff!==0);
      if(hasProblems&&!window.confirm(`Hay diferencias que requieren revisión (facturas ${result.invoiceDiff}, físico ${result.physicalDiff??'sin conteo'}). ¿Guardar el día como PENDIENTE?`))return;
      const headRef=doc(db,'glpLedgerState',capacity),dayRef=doc(db,'glpDaily',recordId(capacity,nextDate));
      await runTransaction(db,async tx=>{
        const old=await tx.get(headRef);const day=await tx.get(dayRef);
        if(day.exists())throw new Error('Esta fecha ya fue registrada. Actualiza la pantalla.');
        if(old.exists()){
          const current=old.data();
          if(moveDay(current.lastDate,1)!==nextDate||['full','empty','invoiceA','invoiceB'].some(k=>current[k]!==base[k]))throw new Error('El último día cambió en otra sesión. Vuelve a cargar.');
        } else if(head)throw new Error('La apertura cambió en otra sesión.');
        tx.set(dayRef,{capacity,date:nextDate,...result,createdBy:auth.currentUser.uid,createdAt:serverTimestamp(),status:hasProblems?'pendiente':'conciliado'});
        tx.set(headRef,{lastDate:nextDate,full:result.full,empty:result.empty,invoiceA:result.invoiceA,invoiceB:result.invoiceB,updatedBy:auth.currentUser.uid,updatedAt:serverTimestamp()});
      });
      setMonth(nextDate.slice(0,7));setDraft(emptyForm());setNotice(`Registrado ${nextDate}. El siguiente día quedó habilitado.`);setDrivers(null);
    }catch(e){setError(e.message||'No se pudo guardar el día.');}finally{setSaving(false);}
  };
  const consultDrivers=async()=>{
    setError('');setDrivers(null);
    try{
      const all=await getDocs(collection(db,'routes'));
      const related=all.docs.filter(r=>r.data().capacity===capacity && routeDate(r.data().startedAt)===nextDate);
      let qty=0,empties=0,amount=0,expenses=0;
      for(const r of related){const sales=await getDocs(collection(db,'routes',r.id,'sales'));const costs=await getDocs(collection(db,'routes',r.id,'expenses'));
        for(const s of sales.docs){qty+=Number(s.data().quantity||0);empties+=Number(s.data().empties||0);amount+=Number(s.data().amount||0);}
        for(const c of costs.docs)expenses+=Number(c.data().amount||0);
      }
      setDrivers({routes:related.length,qty,empties,amount,expenses});
    }catch(e){setError(`No fue posible consultar las rutas: ${e.message}`);}
  };
  const previewRow=preview||{openingFull:previous.full||0,openingEmpty:previous.empty||0,full:previous.full||0,empty:previous.empty||0,total:(previous.full||0)+(previous.empty||0),receivedEmpty:Number(draft.soldFull)||0,defectiveEmpty:Number(draft.defectiveFull)||0,invoiceA:carryA,invoiceB:carryB,invoiceUnits:0,estimatedAmount:0};
  const following={openingFull:previewRow.full,openingEmpty:previewRow.empty,plantFull:0,replacementFull:0,soldFull:0,defectiveFull:0,full:previewRow.full,receivedEmpty:0,defectiveEmpty:0,emptiesToPlant:0,empty:previewRow.empty,total:previewRow.total,invoiceA:previewRow.invoiceA,invoiceB:previewRow.invoiceB,invoiceUnits:0,price:previewRow.price??0,estimatedAmount:0,status:'proyección',nonWorking:false};
  return <div className="content-stack ledger">
    <div className="section-heading"><div><h1>Inventario y movimientos</h1><p>Registro lineal de GLP: garrafas llenas · garrafas vacías · control de facturas prevaloradas</p></div><span className="live"><span/>Control de GLP</span></div>
    <section className="panel">
      <div className="ledger-toolbar"><label>Capacidad<select value={capacity} onChange={e=>setCapacity(e.target.value)}><option value="10">Garrafas de 10 kg</option><option value="45">Garrafas de 45 kg</option></select></label><label>Mes del reporte<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><div className="ledger-summary"><strong>Último día registrado</strong><span>{head?.lastDate||'Sin apertura'}</span></div><div className="ledger-summary"><strong>Fecha siguiente obligatoria</strong><span>{nextDate}</span></div></div>
      {!head&&<div className="ledger-opening"><h3>Datos iniciales de GLP</h3><p>Registra una sola vez el inventario inicial (llenas y vacías), la fecha y los últimos correlativos de facturas. Referencia: hoja Inicio, celdas K35, K36 y K37 de la matriz.</p><div className="ledger-input-grid">
        {[['date','Fecha inicial'],['full','Saldo inicial de llenas'],['empty','Saldo inicial de vacías'],['invoiceA','Última factura primera serie'],['invoiceB','Última factura segunda serie (0 si no inició)']].map(([field,title])=><label className="ledger-field" key={field}>{title}<input disabled={!editable} type={field==='date'?'date':'number'} min={field==='date'?undefined:'0'} step={field==='date'?undefined:'1'} value={opening[field]} onChange={e=>setOpening(v=>({...v,[field]:e.target.value}))}/></label>)}
        <div className="ledger-initial-total"><small>Total inicial de envases</small><strong>{startOk?formattedNumber(Number(opening.full)+Number(opening.empty)):'—'}</strong><small>Se calculará; no se ingresa manualmente.</small></div>
      </div></div>}
      <div className="ledger-headline"><CalendarDays size={18}/><strong>Vista lineal: tres días anteriores, día a registrar y un día siguiente</strong><span>Las celdas amarillas se ingresan. Las celdas grises se calculan.</span></div>
      <div className="glp-instructions"><span><i className="glp-swatch editable"/> Se escribe</span><span><i className="glp-swatch formula"/> Automático</span><span><i className="glp-swatch selected"/> Día actual</span><span><i className="glp-swatch projection"/> Día siguiente (0)</span></div>
      <div className="ledger-scroll"><table className="ledger-table glp-sheet"><thead><tr><th rowSpan="2" className="glp-frozen">DÍA</th><th colSpan="6" className="glp-group glp-green">GARRAFAS LLENAS</th><th colSpan="5" className="glp-group glp-blue">GARRAFAS VACÍAS</th><th rowSpan="2" className="glp-group glp-sand">TOTAL EN ALMACÉN</th><th colSpan="6" className="glp-group glp-purple">CONTROL DE FACTURAS PREVALORADAS</th></tr><tr>
        <th>Saldo anterior</th><th>De planta</th><th>Por reposición</th><th>Entregadas (GLP)</th><th>Defectuosas</th><th>Saldo final</th>
        <th>Saldo anterior</th><th>Recuperadas = entregadas</th><th>Defectuosas = llenas defect.</th><th>Vacías a planta</th><th>Saldo final</th>
        <th>Final serie 1</th><th>Final serie 2</th><th>Unidades</th><th>Precio Bs</th><th>Importe Bs</th><th>Control</th></tr></thead><tbody>
        {days.slice(0,3).map(day=><DailyReadOnly key={day} date={day} row={nearby[day]||map[day]}/>)}
        <tr className="glp-current-row"><td className="glp-date">{nextDate}<small>{editable?'EDITABLE':'CONSULTA'}</small></td>
          <td className="glp-cell-auto"><Calculated value={previous.full}/></td><td className="glp-edit">{activeNumbers('plantFull','Llenas recibidas de planta')}</td><td className="glp-edit">{activeNumbers('replacementFull','Llenas recibidas por reposición')}</td><td className="glp-edit">{activeNumbers('soldFull','Entregadas por intercambio de GLP')}</td><td className="glp-edit">{activeNumbers('defectiveFull','Llenas defectuosas')}</td><td className="glp-cell-result"><Calculated value={preview?.full} important/></td>
          <td className="glp-cell-auto"><Calculated value={previous.empty}/></td><td className="glp-cell-auto"><Calculated value={previewRow.receivedEmpty}/></td><td className="glp-cell-auto"><Calculated value={previewRow.defectiveEmpty}/></td><td className="glp-edit">{activeNumbers('emptiesToPlant','Vacías enviadas a planta')}</td><td className="glp-cell-result"><Calculated value={preview?.empty} important/></td>
          <td className="glp-cell-result"><Calculated value={preview?.total} important/></td>
          <td className="glp-edit"><Quantity label="Última factura primera serie" value={draft.invoiceA} disabled={!editable||draft.nonWorking} placeholder={String(carryA)} onChange={v=>update('invoiceA',v)}/></td><td className="glp-edit"><Quantity label="Última factura segunda serie" value={draft.invoiceB} disabled={!editable||draft.nonWorking} placeholder={String(carryB)} onChange={v=>update('invoiceB',v)}/></td>
          <td className="glp-cell-auto"><Calculated value={preview?.invoiceUnits}/></td><td className="glp-edit"><input className="glp-cell-input glp-wide" aria-label="Precio unitario por garrafa" type="number" min="0" step="0.01" value={draft.unitPrice} placeholder={lastPrice||'Bs'} disabled={!editable||draft.nonWorking} onChange={e=>update('unitPrice',e.target.value)}/></td>
          <td className="glp-cell-result">{preview?formattedMoney(preview.estimatedAmount):'—'}</td><td className={!preview||preview.invoiceDiff!==0?'glp-alert':'glp-ok'}>{!preview?'Revisar':preview.invoiceDiff===0?'OK':`DIF. ${preview.invoiceDiff}`}</td>
        </tr>
        <DailyReadOnly date={moveDay(nextDate,1)} row={following} kind="future"/>
      </tbody></table></div>
      <div className="glp-bottom-controls"><label className="ledger-check"><input disabled={!editable} type="checkbox" checked={draft.nonWorking} onChange={e=>setDraft(v=>({...v,nonWorking:e.target.checked,...(e.target.checked?{plantFull:'0',replacementFull:'0',soldFull:'0',defectiveFull:'0',emptiesToPlant:'0',invoiceA:'',invoiceB:'',unitPrice:''}:{})}))}/> Domingo, feriado o día sin actividad: registrar igualmente y trasladar los saldos</label><label className="ledger-field glp-note">Observaciones del día<input maxLength="300" disabled={!editable} value={draft.note} placeholder="Ej.: feriado, documento de planta, diferencia en la ruta" onChange={e=>update('note',e.target.value)}/></label></div>
      <details className="glp-audit"><summary>Conteo físico opcional para detectar faltantes o sobrantes</summary><div className="ledger-input-grid"><label className="ledger-field">Llenas contadas<input disabled={!editable} type="number" min="0" value={draft.physicalFull} onChange={e=>update('physicalFull',e.target.value)}/></label><label className="ledger-field">Vacías contadas<input disabled={!editable} type="number" min="0" value={draft.physicalEmpty} onChange={e=>update('physicalEmpty',e.target.value)}/></label></div><p className="hint">El total contable varía temporalmente si hay envases en tránsito hacia o desde planta. Solo el conteo físico permite detectar un faltante; se preserva como diferencia pendiente, no como ajuste silencioso.</p></details>
      {editable&&<><div className="ledger-driver"><div><strong>Propuesta desde las rutas de choferes</strong><p>Se consultan rutas iniciadas ese día. Si un viaje cruza fechas, conciliar manualmente cada movimiento antes de confirmar el día.</p></div><button type="button" className="secondary-small" onClick={consultDrivers}><Truck size={17}/> Consultar rutas</button></div>
        {drivers&&<div className="ledger-driver-result"><span>{drivers.routes} rutas · {drivers.qty} entregadas · {drivers.empties} vacías · Bs {formattedMoney(drivers.amount)} venta · Bs {formattedMoney(drivers.expenses)} gastos</span>{drivers.qty!==drivers.empties&&<strong>Atención: diferencia real de envases en ruta ({drivers.qty-drivers.empties}). No se iguala automáticamente.</strong>}<button type="button" className="secondary-small" onClick={()=>update('soldFull',String(drivers.qty))}>Usar entregas informadas (verificar)</button></div>}
        <div className="glp-savebar"><span><Info size={16}/> Guardar completa solo el día consecutivo. No se pueden saltar fechas.</span><button className="primary" type="button" disabled={saving||headLoading||nextDate>today} onClick={closeDay}><ClipboardCheck size={17}/>{saving?'Guardando...':'Guardar y cerrar día'}</button></div>
      </>}
      {!editable&&<p className="hint">Acceso de propietario: consulta de inventario y movimientos. Solo el administrador registra cierres.</p>}
      {error&&<div className="error"><AlertTriangle size={16}/>{error}</div>}{notice&&<div className="notice"><CheckCircle2 size={16}/>{notice}</div>}
      <p className="ledger-warning"><Lock size={15}/> Piloto: los cierres no se editan. Antes de registrar datos reales se debe implementar corrección auditada, respaldo y conciliación final con choferes y facturas individuales.</p>
    </section>
    <section className="panel"><div className="glp-month-title"><div><h2>Movimiento mensual de producto</h2><p className="hint">Se completa automáticamente con los días guardados y continúa al cambiar de mes.</p></div><strong>{month}</strong></div><div className="ledger-scroll"><table className="ledger-table glp-monthly"><thead><tr><th>Día</th><th>Llenas inicial</th><th>De planta</th><th>Reposición</th><th>Entregadas</th><th>Llenas final</th><th>Vacías inicial</th><th>Recuperadas</th><th>A planta</th><th>Vacías final</th><th>Total almacén</th><th>Unidades fact.</th><th>Importe Bs</th><th>Estado</th></tr></thead><tbody>{monthDays.map(day=>{const r=map[day];return <tr key={day} className={!r?'ledger-empty-row':''}><td>{day.slice(8)}</td>{r?<><td>{note(r.openingFull)}</td><td>{note(r.plantFull)}</td><td>{note(r.replacementFull)}</td><td>{note(r.soldFull)}</td><td>{note(r.full)}</td><td>{note(r.openingEmpty)}</td><td>{note(r.receivedEmpty)}</td><td>{note(r.emptiesToPlant)}</td><td>{note(r.empty)}</td><td>{note(r.total)}</td><td>{note(r.invoiceUnits)}</td><td>{formattedMoney(r.estimatedAmount)}</td><td>{r.nonWorking?'Sin movimiento':r.status}</td></>:<td colSpan="13">—</td>}</tr>})}</tbody><tfoot><tr><th>TOTAL MES</th><th>—</th><th colSpan="2">{formattedNumber(totals.received)} recibidas</th><th>{formattedNumber(totals.delivered)}</th><th>—</th><th>—</th><th>{formattedNumber(totals.empties)}</th><th>{formattedNumber(totals.toPlant)}</th><th>—</th><th>—</th><th>{formattedNumber(totals.invoices)}</th><th>{formattedMoney(totals.amount)}</th><th>{monthly.length} días</th></tr></tfoot></table></div>
      <p className="hint">El importe es referencial si hay distintos precios según destino. La recaudación real se conciliará con las facturas y los gastos de Jaime, Willy y los demás choferes.</p>
    </section>
  </div>;
}
