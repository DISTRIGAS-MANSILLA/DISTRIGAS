import Ledger from './Ledger.jsx';
import Routes from './Routes.jsx';
import Users from './Users.jsx';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  doc, getDoc, onSnapshot, runTransaction, collection, query, orderBy,
  limit, serverTimestamp,
} from 'firebase/firestore';
import {
  Boxes, ChartNoAxesCombined, ClipboardList, Fuel, LayoutDashboard,
  LogOut, Menu, PackageCheck, Plus, ShieldCheck, Truck, Wallet, Wrench, X,
  AlertTriangle, RefreshCw, LockKeyhole, UsersRound,
} from 'lucide-react';
import { auth, configured, db } from './firebase';
import './index.css';

const types = [
  { id: '10', label: 'Garrafas 10 kg' },
  { id: '45', label: 'Garrafas 45 kg' },
];
const blank = { full: 0, empty: 0, damaged: 0 };
const operations = [
  { id: 'receiveFull', title: 'Ingreso de llenas', change: { full: 1 } },
  { id: 'receiveEmpty', title: 'Ingreso de vacías', change: { empty: 1 } },
  { id: 'dispatchFull', title: 'Salida de llenas', change: { full: -1 } },
  { id: 'dispatchEmpty', title: 'Salida de vacías', change: { empty: -1 } },
  { id: 'exchangeSale', title: 'Intercambio (llena por vacía)', change: { full: -1, empty: 1 } },
  { id: 'markDamaged', title: 'Retirar vacía dañada', change: { empty: -1, damaged: 1 } },
];
const navigation = [
  { key: 'dashboard', title: 'Inicio', icon: LayoutDashboard },
  { key: 'inventory', title: 'Inventario y movimientos', icon: Boxes },
  { key: 'drivers', title: 'Choferes y rutas', icon: Truck },
  { key: 'users', title: 'Usuarios y permisos', icon: UsersRound },
  { key: 'cash', title: 'Ventas y rendiciones', icon: Wallet },
  { key: 'replacement', title: 'Reposición YPFB', icon: RefreshCw },
  { key: 'reports', title: 'Reportes', icon: ChartNoAxesCombined },
];
const money = n => new Intl.NumberFormat('es-BO', { maximumFractionDigits: 0 }).format(n);
const messageFromError = error => {
  const code = error?.code || '';
  if (code.includes('permission-denied')) return 'No tienes permisos para esta operación. Revisa tu rol y las reglas de Firestore.';
  if (code.includes('invalid-credential')) return 'Correo o contraseña incorrectos.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'No hay conexión con Firebase. Revisa internet.';
  return error?.message || 'Ocurrió un error inesperado.';
};

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await signInWithEmailAndPassword(auth, email.trim(), password); }
    catch (err) { setError(messageFromError(err)); }
    finally { setBusy(false); }
  };
  return <main className="auth-screen">
    <div className="login-brand"><span className="logo"><Fuel size={30}/></span><div><strong>DISTRIGAS</strong><small>Sistema integral de distribución de GLP</small></div></div>
    <form className="login-card" onSubmit={submit}>
      <div className="login-icon"><LockKeyhole size={24}/></div>
      <h1>Bienvenido</h1><p>Accede al panel con tu usuario autorizado.</p>
      <label>Correo electrónico<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="correo@empresa.com" /></label>
      <label>Contraseña<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Tu contraseña" /></label>
      {error && <div className="error" role="alert">{error}</div>}
      <button disabled={busy} className="primary full">{busy ? 'Ingresando...' : 'Ingresar al sistema'}</button>
      <div className="help">Acceso restringido a personal autorizado.</div>
    </form>
  </main>;
}

function Inventory({ profile }) {
  const [stock, setStock] = useState({});
  const [moves, setMoves] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [capacity, setCapacity] = useState('10');
  const [operation, setOperation] = useState('receiveFull');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = ['admin','warehouse'].includes(profile.role);
  useEffect(() => {
    if (!db) return;
    let completed = 0;
    const unsubs = types.map(t => onSnapshot(doc(db, 'inventory', t.id), s => {
      setStock(old => ({...old, [t.id]: s.exists() ? s.data() : blank}));
      completed++; if (completed >= 2) setLoading(false);
    }, err => { setError(messageFromError(err)); setLoading(false); }));
    const unsubMoves = onSnapshot(query(collection(db,'movements'),orderBy('createdAt','desc'),limit(15)), s => {
      setMoves(s.docs.map(d=>({id:d.id,...d.data()})));
    }, err => setError(messageFromError(err)));
    return () => {unsubs.forEach(f=>f());unsubMoves();};
  }, []);
  const submit = async e => {
    e.preventDefault(); setError('');
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 1000000) return setError('La cantidad debe ser un número entero entre 1 y 1.000.000.');
    const op = operations.find(o=>o.id===operation);
    setBusy(true);
    try {
      await runTransaction(db, async tx => {
        const stockRef = doc(db,'inventory',capacity);
        const moveRef = doc(collection(db,'movements'));
        const existing = await tx.get(stockRef);
        const before = existing.exists() ? existing.data() : blank;
        const next = Object.fromEntries(['full','empty','damaged'].map(key=> [key, Number(before[key] || 0) + (op.change[key] || 0)*qty]));
        if (Object.values(next).some(x => x < 0)) throw new Error('No existe stock suficiente para registrar esta operación.');
        tx.set(stockRef, {...next, updatedAt:serverTimestamp(), updatedBy:auth.currentUser.uid});
        tx.set(moveRef, {
          capacity, type:operation, quantity:qty, note:note.trim().slice(0,300),
          before: {full:Number(before.full||0),empty:Number(before.empty||0),damaged:Number(before.damaged||0)},
          after:next, createdBy:auth.currentUser.uid, createdAt:serverTimestamp()
        });
      });
      setQuantity(''); setNote('');
    } catch(err) { setError(messageFromError(err)); }
    finally { setBusy(false); }
  };
  return <div className="content-stack">
    <div className="section-heading"><div><h1>Inventario de garrafas</h1><p>Control de envases de 10 y 45 kg y movimientos con historial.</p></div></div>
    <div className="inventory-grid">{types.map(t=>{const s=stock[t.id]||blank;return <section className="panel" key={t.id}>
      <div className="panel-heading"><span className="circle blue"><Boxes size={18}/></span><strong>{t.label}</strong></div>
      <div className="stock-grid"><div><small>Llenas</small><strong>{loading?'—':money(s.full||0)}</strong></div><div><small>Vacías</small><strong>{loading?'—':money(s.empty||0)}</strong></div><div><small>Dañadas</small><strong>{loading?'—':money(s.damaged||0)}</strong></div></div>
    </section>})}</div>
    {canEdit && <section className="panel"><div className="panel-heading"><span className="circle green"><Plus size={18}/></span><strong>Registrar movimiento</strong></div>
      <p className="hint">Los movimientos modifican existencias y quedan registrados. Esta pantalla es para el almacén; las rutas y ventas detalladas se integrarán en otra etapa.</p>
      <form onSubmit={submit} className="movement-form">
        <label>Capacidad<select value={capacity} onChange={e=>setCapacity(e.target.value)}>{types.map(t=><option value={t.id} key={t.id}>{t.label}</option>)}</select></label>
        <label>Operación<select value={operation} onChange={e=>setOperation(e.target.value)}>{operations.map(op=><option value={op.id} key={op.id}>{op.title}</option>)}</select></label>
        <label>Cantidad<input min="1" max="1000000" type="number" required step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="Ej. 50"/></label>
        <label className="wide">Observación (opcional)<input value={note} maxLength={300} onChange={e=>setNote(e.target.value)} placeholder="Motivo o referencia del movimiento"/></label>
        <div className="submit-row"><button className="primary" disabled={busy}>{busy?'Guardando...':'Guardar movimiento'}</button></div>
      </form>
    </section>}
    {error && <div role="alert" className="error">{error}</div>}
    <section className="panel"><div className="panel-heading"><span className="circle"><ClipboardList size={18}/></span><strong>Últimos 15 movimientos</strong></div>
      {moves.length===0 ? <p className="hint">Aún no hay movimientos registrados.</p> : <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Garrafa</th><th>Operación</th><th>Cantidad</th><th>Observación</th></tr></thead><tbody>
        {moves.map(m=><tr key={m.id}><td>{m.createdAt?.toDate?.().toLocaleString('es-BO')||'Pendiente'}</td><td>{m.capacity} kg</td><td>{operations.find(o=>o.id===m.type)?.title||m.type}</td><td>{m.quantity}</td><td>{m.note||'—'}</td></tr>)}
      </tbody></table></div>}
    </section>
  </div>;
}

function Dashboard({ onGo }) {
  const [stocks,setStocks]=useState({});
  useEffect(()=>{
    const unsubscribe=types.map(t=>onSnapshot(doc(db,'glpLedgerState',t.id),s=>setStocks(x=>({...x,[t.id]:s.exists()?s.data():null})),()=>{}));
    return ()=>unsubscribe.forEach(x=>x());
  },[]);
  const total = field=>types.reduce((sum,t)=>sum+Number(stocks[t.id]?.[field]||0),0);
  return <div className="content-stack"><div className="section-heading"><div><h1>Resumen general</h1><p>Existencias del registro lineal de GLP, con saldos del último día guardado en cada capacidad.</p></div><span className="live"><span/>En línea</span></div>
    <div className="metrics"><div className="metric"><span className="circle blue"><PackageCheck size={20}/></span><small>Garrafas llenas</small><strong>{money(total('full'))}</strong></div><div className="metric"><span className="circle green"><Boxes size={20}/></span><small>Garrafas vacías</small><strong>{money(total('empty'))}</strong></div><div className="metric"><span className="circle"><ClipboardList size={20}/></span><small>Total en almacén</small><strong>{money(total('full')+total('empty'))}</strong></div></div>
    <div className="two-col"><section className="panel"><h2>Inventario y movimientos</h2><p className="hint">Registro lineal en tres bloques: llenas, vacías y control de facturas. Solo el administrador ingresa el día consecutivo.</p><button className="primary" onClick={()=>onGo('inventory')}>Abrir inventario y movimientos</button></section><section className="panel"><h2>Operaciones GLP</h2><div className="feature"><Truck size={18}/> Reportes de Jaime, Willy y futuros choferes</div><div className="feature"><Wallet size={18}/> Rendiciones y gastos por ruta</div><div className="feature"><RefreshCw size={18}/> Reposición de envases según YPFB</div></section></div>
    <p className="small-note"><AlertTriangle size={15}/> El inventario anterior quedó fuera del menú para evitar registros duplicados. No cargar información real hasta validar los saldos iniciales, las reglas y el procedimiento de corrección de cierres.</p>
  </div>;
}

function Placeholder({ page }) {
  const info = {
    drivers:['Choferes y rutas','Aquí registraremos vehículos, salidas a venta, recolecciones y retornos de vacías.'],
    cash:['Ventas y rendiciones','Aquí controlaremos ventas, efectivo, peajes, gastos y arqueos por chofer.'],
    replacement:['Reposición YPFB','Aquí implementaremos los factores mensuales de 10 y 45 kg, saldos fraccionarios y notas de débito.'],
    reports:['Reportes','Aquí construiremos los indicadores para administradores y propietarios.'],
  }[page] || ['Próximo módulo',''];
  return <div className="content-stack"><div className="section-heading"><div><h1>{info[0]}</h1><p>{info[1]}</p></div></div><section className="panel empty"><Wrench size={36}/><h2>Programado para la siguiente etapa</h2><p>Primero validaremos el inventario y la seguridad de acceso. Esta sección no registra datos todavía.</p></section></div>;
}

function Workspace({ user, profile }) {
  const visibleNavigation = profile.role==='driver' ? navigation.filter(x=>['drivers'].includes(x.key)) : profile.role==='warehouse' ? navigation.filter(x=>['dashboard','inventory'].includes(x.key)) : navigation.filter(x=>x.key!=='users'||['owner','admin'].includes(profile.role));
  const [page,setPage]=useState(profile.role==='driver'?'drivers':'dashboard');
  const [menu,setMenu]=useState(false);
  const select = key => {setPage(key);setMenu(false)};
  return <div className="app-shell">
    {menu&&<div className="overlay" onClick={()=>setMenu(false)}/>}
    <aside className={'sidebar '+(menu?'expanded':'')}>
      <div className="brand"><div className="logo"><Fuel size={25}/></div><div><strong>DISTRIGAS</strong><small>Gestión de GLP</small></div><button className="mobile-close" onClick={()=>setMenu(false)}><X size={19}/></button></div>
      <div className="nav-group-title">OPERACIONES</div>
      <nav>{visibleNavigation.map(item=>{const Icon=item.icon;return <button key={item.key} onClick={()=>select(item.key)} className={page===item.key?'nav-item selected':'nav-item'}><Icon size={19}/>{item.title}</button>})}</nav>
      <div className="sidebar-bottom"><div className="user-badge"><span className="avatar">{(profile.name||user.email||'U')[0].toUpperCase()}</span><div><strong>{profile.name||user.email}</strong><small>{profile.role}</small></div></div><button className="logout" onClick={()=>signOut(auth)}><LogOut size={17}/> Cerrar sesión</button></div>
    </aside>
    <div className="main-area"><header className="topbar"><button className="menu-button" onClick={()=>setMenu(true)}><Menu size={23}/></button><div className="crumb">Sistema de Distribución <span>/</span> {navigation.find(x=>x.key===page)?.title}</div><div className="secure"><ShieldCheck size={16}/> Acceso protegido</div></header><main className="main-content">{page==='users'&&['owner','admin'].includes(profile.role)?<Users profile={profile}/>:page==='drivers'?<Routes profile={profile}/>:page==='dashboard'?<Dashboard onGo={select}/>:page==='inventory'?<Ledger profile={profile}/>:<Placeholder page={page}/>}</main></div>
  </div>;
}

export default function App() {
  const [user,setUser]=useState(undefined);
  const [profile,setProfile]=useState(undefined);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!auth)return;
    return onAuthStateChanged(auth, current=>{setUser(current);setProfile(undefined);setError('')},err=>setError(messageFromError(err)));
  },[]);
  useEffect(()=>{
    if(!user||!db)return;
    let alive=true;
    getDoc(doc(db,'users',user.uid)).then(s=>{if(alive)setProfile(s.exists()&&s.data().active!==false?s.data():null)}).catch(err=>{if(alive){setError(messageFromError(err));setProfile(null)}});
    return ()=>{alive=false};
  },[user]);
  if(!configured)return <div className="config-screen"><AlertTriangle size={36}/><h1>Falta configurar Firebase</h1><p>Crea el archivo <code>.env.local</code> con las claves públicas de la aplicación web Firebase. Consulta <code>INSTRUCCIONES.md</code>.</p></div>;
  if(user===undefined|| (user&&profile===undefined))return <div className="config-screen"><RefreshCw size={32}/><p>Cargando DISTRIGAS...</p></div>;
  if(!user)return <Login/>;
  if(!profile||!['owner','admin','warehouse','viewer','driver'].includes(profile.role))return <div className="config-screen"><ShieldCheck size={36}/><h1>Cuenta sin perfil autorizado</h1><p>{error||'Tu cuenta no tiene un perfil autorizado o fue desactivada. Consulta al administrador.'}</p><p>La administración debe crear <code>users/{user.uid}</code> con <code>role: "owner"</code> para el primer propietario.</p><button className="primary" onClick={()=>signOut(auth)}>Cerrar sesión</button></div>;
  return <Workspace user={user} profile={profile}/>;
}
