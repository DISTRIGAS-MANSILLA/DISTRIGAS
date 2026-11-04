# DISTRIGAS v0.5 — Inventario y movimientos

## Cambios
- Menú: una sola sección **Inventario y movimientos**. Desaparece el duplicado "Libro diario GLP".
- Diseño lineal de **tres bloques**: garrafas llenas, garrafas vacías y control de facturas.
- **La fila del día actual se edita directamente**, como en MOV-GARRAFAS. Se muestran 3 días anteriores y 1 día siguiente de referencia (sin registrar).
- Inicio por capacidad (10 o 45 kg): fecha, saldo inicial de llenas, saldo inicial de vacías, factura inicial por serie.
- Cálculos de la matriz: `G=B+C+D-E-F`, `K=E`, `L=F`, `N=J+K+L-M`, `P=G+N`.
- Facturas: `V=(T-T_anterior)+(U-U_anterior)` al mantener el correlativo de la primera serie cuando comienza la segunda. `X=V*W`.
- Día sin actividad: mantiene los saldos y los correlativos, y debe cerrarse para continuar al día siguiente.
- Movimiento mensual en la parte inferior, que continúa automáticamente al cambiar de mes.
- Panel Inicio consulta `glpLedgerState`, que es la misma fuente del inventario lineal, en lugar del inventario antiguo separado.

## Instalar sobre DISTRIGAS v0.4 en Windows
1. **Guardar copia del proyecto** o confirmar que v0.4 está en GitHub.
2. Descomprime este ZIP en `C:\Users\nelso\DISTRIGAS` con `-Force`, sin modificar `.env.local`.
3. Ejecuta `npm.cmd run build`.
4. Comprueba el diseño en `http://localhost:5173/` con cuenta administradora.
5. Si funciona, `npx.cmd firebase deploy --only hosting --project distrigas-cbb68`.
6. Finalmente, `git add src/App.jsx src/Ledger.jsx src/Ledger.css INSTRUCCIONES_V05.md`, `git commit -m "DISTRIGAS v0.5 inventario y movimientos alineado con matriz"` y `git push origin main`.

## Firestore
- **Esta actualización mantiene los nombres y estructura de colecciones y documentos de v0.4**, por lo que usa las reglas ya publicadas de v0.4. No es necesario republicarlas solo para esta vista.
- Los cierres guardados son inmutables. Solo el administrador registra días. Propietarios consultan.
- Si ya se introdujeron datos de prueba mediante v0.4, se visualizarán en el mismo historial. No los borres sin respaldarlos.

## Importante antes de producción
La hoja de referencia es `MOV-GARRAFAS` y los saldos de apertura vienen de `Inicio!K35:K37`. El proyecto es una implementación piloto: sigue pendiente una corrección auditada de cierres, respaldo externo, reconciliación de facturas individuales, ajuste de precios por destino y validación del procedimiento operativo con la distribuidora. La vista de rutas incluye únicamente viajes iniciados en la fecha consultada y requiere revisión para rutas de varios días.
